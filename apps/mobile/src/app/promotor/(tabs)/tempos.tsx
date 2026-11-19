import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Text } from 'react-native'
import { Badge, Banner, Button, Card, EmptyState, ErrorView, LoadingView, Muted, PromptSheet, Row, Screen, SectionTitle, styles } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { formatDiff, formatHms, formatLongDate, formatShort, formatTime } from '@/lib/format'
import { colors, type } from '@/lib/theme'
import type { PromotorTimeView, TimeOccurrence } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

const kindLabel = (o: TimeOccurrence) => (o.kind === 'DESLOCAMENTO' ? 'Deslocamento acima do normal' : 'Tempo acima do normal no cliente')

/**
 * Meu tempo: o dia do próprio promotor. Resumo, desvios de tempo acima do normal (com a explicação dele, que o supervisor
 * vê) e o que já passou do limite e ainda está em andamento. Atualiza a cada minuto.
 */
export default function MeuTempo() {
  const [justify, setJustify] = useState<TimeOccurrence | null>(null)
  const query = useQuery(() => api<PromotorTimeView>('/promotor/time-report'))
  const reload = query.reload

  useFocusEffect(
    useCallback(() => {
      void reload()
      const timer = setInterval(() => void reload(), 60_000)
      return () => clearInterval(timer)
    }, [reload]),
  )

  if (query.loading && !query.data) return <LoadingView />
  if (query.error && !query.data) return <ErrorView message={query.error} onRetry={query.refresh} />
  const view = query.data!
  const day = view.day

  return (
    <Screen refreshing={query.refreshing} onRefresh={query.refresh}>
      <SectionTitle>{formatLongDate(view.date)}</SectionTitle>
      {view.warnings.map((w) => <Banner key={w} text={w} tone="warning" />)}
      {!day ? <EmptyState title="Sem roteiro hoje" text="Quando o seu roteiro estiver lançado, o resumo do dia aparece aqui." /> : null}

      {day ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>
              <Text style={styles.number}>{day.visited} de {day.total}</Text> clientes visitados
            </Text>
            <Muted>
              {day.pending + day.inProgress > 0 ? `${day.pending + day.inProgress} a visitar · ` : ''}
              {day.notVisited} sem visita
            </Muted>
            <Muted>
              Tempo em loja {formatShort(day.clientSeconds)} · deslocamento {formatShort(day.travelSeconds)}
            </Muted>
            <Muted>
              Primeira visita {formatTime(day.firstCheckin)} · última {formatTime(day.lastCheckout)}
            </Muted>
            <Muted>Atualizado às {formatTime(view.generatedAt)}</Muted>
          </Card>

          {day.live.length > 0 ? (
            <>
              <SectionTitle>Acontecendo agora</SectionTitle>
              {day.live.map((l, i) => (
                <Card key={i} variant="emAtendimento">
                  <Text style={styles.text}>
                    {l.kind === 'ATENDIMENTO_LONGO' ? `Você está em ${l.clientName ?? 'um cliente'} há ${formatShort(l.elapsedSeconds)}` : `Você está em deslocamento há ${formatShort(l.elapsedSeconds)}`}
                  </Text>
                  <Muted>O normal é cerca de {formatShort(l.baseSeconds)}.</Muted>
                </Card>
              ))}
            </>
          ) : null}

          <SectionTitle>Desvios do padrão · {day.occurrences.length}</SectionTitle>
          {day.occurrences.length === 0 ? <Muted>Nenhum ponto acima do normal hoje. Continue assim!</Muted> : null}
          {day.occurrences.map((o) => (
            <Card key={`${o.rowId}-${o.kind}`} style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={[type.textoForte, { color: colors.justificado, flex: 1 }]}>{kindLabel(o)}</Text>
                <Badge label={formatDiff(o.diffSeconds)} tone="justificado" />
              </Row>
              <Text style={styles.text}>{o.clientName}{o.city ? ` · ${o.city}` : ''}</Text>
              <Muted>
                {formatTime(o.from)} – {formatTime(o.to)} · {formatHms(o.valueSeconds)} · o normal é {formatHms(o.baseSeconds)}
              </Muted>
              {o.flag?.justification ? (
                <Muted>Sua explicação: {o.flag.justification}{o.flag.acknowledgedAt ? ' (supervisor ciente)' : ''}</Muted>
              ) : null}
              {o.flag && !o.flag.acknowledgedAt ? (
                <Button title={o.flag.justification ? 'Alterar explicação' : 'Explicar'} variant="secondary" small onPress={() => setJustify(o)} />
              ) : null}
            </Card>
          ))}

          {day.notVisitedList.length > 0 ? <SectionTitle>Sem visita · {day.notVisitedList.length}</SectionTitle> : null}
          {day.notVisitedList.map((n) => (
            <Card key={n.rowId} style={{ gap: 2 }}>
              <Text style={styles.text}>{n.clientName}{n.city ? ` · ${n.city}` : ''}</Text>
              <Muted>{n.reason ?? (n.state === 'JUSTIFICADA' ? 'Justificado' : 'Sem justificativa')}{n.comment ? ` · ${n.comment}` : ''}</Muted>
            </Card>
          ))}
        </>
      ) : null}

      <PromptSheet
        visible={!!justify}
        title="Explique o tempo"
        message={justify ? `${kindLabel(justify)}: ${justify.clientName}` : undefined}
        placeholder="Ex.: esperei o gerente conferir o pedido"
        minLength={5}
        confirmLabel="Enviar"
        onConfirm={async (text) => {
          try {
            await api(`/promotor/time-flags/${justify!.flag!.id}/justify`, { body: { text } })
            setJustify(null)
            await query.refresh()
          } catch (e) {
            Alert.alert('Não foi possível enviar', errorMessage(e))
          }
        }}
        onClose={() => setJustify(null)}
      />
    </Screen>
  )
}
