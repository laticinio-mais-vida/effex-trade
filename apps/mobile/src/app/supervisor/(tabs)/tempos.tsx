import { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Text } from 'react-native'
import { Badge, Banner, Button, Card, EmptyState, ErrorView, LoadingView, Muted, Row, Screen, SectionTitle, styles } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatDiff, formatHms, formatLongDate, formatShort, formatTime, todayLocal } from '@/lib/format'
import { downloadAndShare } from '@/lib/shareFile'
import { colors, type } from '@/lib/theme'
import type { TimeOccurrence, TimePromotorDay, TimeReport } from '@/lib/types'
import { emitBadgesChanged } from '@/lib/events'
import { useQuery } from '@/lib/useQuery'

const kindLabel = (o: TimeOccurrence) => (o.kind === 'DESLOCAMENTO' ? 'Deslocamento longo' : o.direction === 'ACIMA' ? 'Tempo longo na loja' : 'Tempo curto na loja')
const ratioText = (r: number) => `${r >= 100 ? '99+' : r.toFixed(1)}x`

/**
 * Tempos de roteiro: tempo em cada cliente e deslocamento da equipe contra a média do histórico. No dia de hoje é o
 * acumulado até o último registro (o relatório "de tarde" do supervisor) e se atualiza a cada minuto.
 */
/** Abre o seletor de data do Android; devolve AAAA-MM-DD (não deixa passar de hoje). */
function pickDate(current: string, onPick: (date: string) => void) {
  DateTimePickerAndroid.open({
    value: new Date(`${current}T12:00:00`),
    maximumDate: new Date(),
    mode: 'date',
    onChange: (event, picked) => {
      if (event.type !== 'set' || !picked) return
      const d = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`
      onPick(d > todayLocal() ? todayLocal() : d)
    },
  })
}

export default function Tempos() {
  const [from, setFrom] = useState(todayLocal())
  const [to, setTo] = useState(todayLocal())
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState(false)
  const isToday = to === todayLocal()
  const ranged = from !== to
  const query = useQuery(() => api<TimeReport>(`/supervisor/time-report?from=${from}&to=${to}`), [from, to])
  const reload = query.reload

  useFocusEffect(
    useCallback(() => {
      void reload()
      if (!isToday) return
      const timer = setInterval(() => void reload(), 60_000)
      return () => clearInterval(timer)
    }, [reload, isToday]),
  )

  const report = query.data
  const days = report ? [...report.promotores].sort((a, b) => b.occurrences.length - a.occurrences.length || a.name.localeCompare(b.name, 'pt-BR')) : []
  const totals = {
    visited: days.reduce((s, p) => s + p.visited, 0),
    total: days.reduce((s, p) => s + p.total, 0),
    occurrences: days.reduce((s, p) => s + p.occurrences.length, 0),
    notVisited: days.reduce((s, p) => s + p.notVisited, 0),
  }

  /** Gera o PDF ou JPEG no servidor e abre o menu de compartilhar. Sem `promotor`, é o consolidado da equipe. */
  async function share(format: 'pdf' | 'jpeg', promotor?: TimePromotorDay) {
    setSending(true)
    try {
      const query = `from=${from}&to=${to}&format=${format}${promotor ? `&promotor=${encodeURIComponent(promotor.key)}` : ''}`
      const slug = promotor ? promotor.name.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '_') : 'equipe'
      await downloadAndShare(`/supervisor/time-report/file?${query}`, `Roteiro_${slug}_${from}${ranged ? `_a_${to}` : ''}.${format === 'jpeg' ? 'jpg' : 'pdf'}`, format === 'jpeg' ? 'image/jpeg' : 'application/pdf')
    } catch (e) {
      Alert.alert('Não foi possível enviar', errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  async function acknowledge(flagId: string) {
    try {
      await api(`/supervisor/time-flags/${flagId}/ack`, { body: {} })
      await query.refresh()
      emitBadgesChanged()
    } catch (e) {
      Alert.alert('Não foi possível dar ciente', errorMessage(e))
    }
  }

  return (
    <Screen refreshing={query.refreshing} onRefresh={query.refresh}>
      <SectionTitle>{ranged ? 'Período' : isToday ? 'Hoje, até o último registro' : 'Dia'} · {ranged ? `${formatDate(from)} a ${formatDate(to)}` : formatLongDate(from)}</SectionTitle>
      <Row style={{ gap: 8 }}>
        <Button title={`De ${formatDate(from)}`} variant="secondary" small onPress={() => pickDate(from, (d) => { setFrom(d); if (d > to) setTo(d) })} style={{ flex: 1 }} />
        <Button title={`Até ${formatDate(to)}`} variant="secondary" small onPress={() => pickDate(to, (d) => { setTo(d); if (d < from) setFrom(d) })} style={{ flex: 1 }} />
      </Row>

      {query.loading && !report ? <LoadingView /> : null}
      {query.error && !report ? <ErrorView message={query.error} onRetry={query.refresh} /> : null}
      {report?.warnings.map((w) => <Banner key={w} text={w} tone="warning" />)}
      {report && days.length === 0 && report.warnings.length === 0 ? <EmptyState title="Nenhum roteiro nesta data" /> : null}

      {report && days.length > 0 ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>
              <Text style={styles.number}>{totals.visited} de {totals.total}</Text> visitas feitas
            </Text>
            <Muted>
              {totals.occurrences} fora da média · {totals.notVisited} não visitados · dados do {report.source === 'TRADEPRO' ? 'TradePro' : 'EFFEX'}
              {isToday ? ` · atualizado às ${formatTime(report.generatedAt)}` : ''}
            </Muted>
          </Card>

          <Row style={{ gap: 8 }}>
            <Button title="Enviar PDF da equipe" variant="secondary" small disabled={sending} onPress={() => void share('pdf')} style={{ flex: 1 }} />
            <Button title="Enviar JPEG da equipe" variant="secondary" small disabled={sending} onPress={() => void share('jpeg')} style={{ flex: 1 }} />
          </Row>

          <SectionTitle>Promotores</SectionTitle>
          {days.map((p) => (
            <PromotorCard key={p.key} p={p} ranged={ranged} expanded={!!open[p.key]} onToggle={() => setOpen((o) => ({ ...o, [p.key]: !o[p.key] }))} onShare={(f) => void share(f, p)} onAck={acknowledge} sending={sending} />
          ))}
          {days.some((p) => p.occurrences.some((o) => o.fallback)) ? <Muted>* sem histórico suficiente para a referência própria: comparação feita contra a média geral.</Muted> : null}
        </>
      ) : null}
    </Screen>
  )
}

function PromotorCard({ p, ranged, expanded, onToggle, onShare, onAck, sending }: { p: TimePromotorDay; ranged: boolean; expanded: boolean; onToggle: () => void; onShare: (format: 'pdf' | 'jpeg') => void; onAck: (flagId: string) => void; sending: boolean }) {
  const waiting = p.pending + p.inProgress
  return (
    <Card onPress={onToggle}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={[styles.sectionTitle, { flex: 1 }]}>{expanded ? '▼ ' : '▶ '}{p.name}</Text>
        {p.occurrences.length > 0 ? <Badge label={`${p.occurrences.length} fora da média`} tone="justificado" /> : null}
      </Row>
      <Muted>
        <Text style={styles.number}>{p.visited} de {p.total}</Text> visitas{waiting > 0 ? ` · ${waiting} a visitar` : ''} · {p.notVisited} sem visita
      </Muted>
      <Muted>
        Loja {formatShort(p.clientSeconds)} · deslocamento {formatShort(p.travelSeconds)}{ranged ? '' : ` · ${formatTime(p.firstCheckin)} às ${formatTime(p.lastCheckout)}`}
      </Muted>
      {p.outsideDay > 0 ? <Text style={[type.secundario, { color: colors.naoFeito }]}>{p.outsideDay} visita(s) registrada(s) em outro dia (roteiro aberto)</Text> : null}

      {expanded ? (
        <>
          <Row style={{ gap: 8 }}>
            <Button title="Enviar PDF" variant="secondary" small disabled={sending} onPress={() => onShare('pdf')} style={{ flex: 1 }} />
            <Button title="Enviar JPEG" variant="secondary" small disabled={sending} onPress={() => onShare('jpeg')} style={{ flex: 1 }} />
          </Row>
          {p.occurrences.length === 0 ? <Muted>Nenhum ponto fora da média neste período.</Muted> : null}
          {p.occurrences.map((o) => {
            const tone = o.direction === 'ABAIXO' ? colors.emAtendimento : colors.justificado
            return (
              <Card key={`${o.rowId}-${o.kind}`} style={{ gap: 2 }}>
                <Text style={[type.textoForte, { color: tone }]}>{kindLabel(o)}</Text>
                <Text style={styles.text}>{o.clientName}{o.city ? ` · ${o.city}` : ''}</Text>
                <Muted>
                  {ranged ? `${formatDate(o.date).slice(0, 5)} · ` : ''}{formatTime(o.from)} – {formatTime(o.to)} · {formatHms(o.valueSeconds)} · média {formatHms(o.baseSeconds)}{o.fallback ? ' *' : ''}
                </Muted>
                <Text style={[type.textoForte, { color: tone }]}>{formatDiff(o.diffSeconds)} ({ratioText(o.ratio)})</Text>
                {o.flag?.justification ? <Muted>Justificativa do promotor: {o.flag.justification}</Muted> : o.flag ? <Muted>Sem justificativa do promotor</Muted> : null}
                {o.flag && !o.flag.acknowledgedAt ? <Button title="Ciente" variant="secondary" small onPress={() => onAck(o.flag!.id)} /> : null}
                {o.flag?.acknowledgedAt ? <Muted>Ciente</Muted> : null}
              </Card>
            )
          })}
          {p.notVisitedList.length > 0 ? <Text style={styles.sectionTitle}>Sem visita · {p.notVisitedList.length}</Text> : null}
          {p.notVisitedList.map((n) => (
            <Card key={n.rowId} style={{ gap: 2 }}>
              <Text style={styles.text}>{ranged ? `${formatDate(n.date).slice(0, 5)} · ` : ''}{n.clientName}{n.city ? ` · ${n.city}` : ''}</Text>
              <Muted>{n.reason ?? (n.state === 'JUSTIFICADA' ? 'Justificado' : 'Sem justificativa')}{n.comment ? ` · ${n.comment}` : ''}</Muted>
            </Card>
          ))}
        </>
      ) : null}
    </Card>
  )
}
