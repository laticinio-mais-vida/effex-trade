import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native'
import { Badge, Banner, Button, Card, CheckOption, EmptyState, Field, Muted, MultiPickerSheet, Row, Segmented, Sheet, styles } from '@/components/ui'
import { FilterChip } from '@/features/audit/FilterChip'
import { PhotoViewer } from '@/features/PhotoViewer'
import { api, errorMessage } from '@/lib/api'
import { resolveUrl } from '@/lib/config'
import { emitBadgesChanged } from '@/lib/events'
import { auditStatusInfo, formatDate, formatTime, photoTypeLabels, todayLocal } from '@/lib/format'
import { colors, radius, space } from '@/lib/theme'
import type { Audit, AuditPhoto, Paged, PhotoType } from '@/lib/types'

type Status = 'pendentes' | 'auditadas' | 'todas'
type Month = 'atual' | 'anterior'
/** Sem mês marcado e sem período livre = padrão da API (últimos 7 dias). */
type Period = { months: Month[]; custom: { from: string; to: string } | null }
type Filters = { clientIds: string[]; promotorIds: string[]; types: PhotoType[]; period: Period }
type FilterOptions = { clients: { id: string; name: string; city: string | null }[]; promotores: { id: string; name: string }[] }

const PAGE_SIZE = 20
const NO_FILTERS: Filters = { clientIds: [], promotorIds: [], types: [], period: { months: [], custom: null } }

/** Primeiro e último dia do mês de `today` deslocado de `offset` meses. */
function monthRange(today: string, offset: number) {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + offset)
  const from = d.toISOString().slice(0, 10)
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return { from, to: d.toISOString().slice(0, 10) }
}

/** Datas enviadas à API; null = padrão. Mês atual + anterior viram um só intervalo. */
function periodRange(period: Period, today: string) {
  if (period.custom) return period.custom
  if (!period.months.length) return null
  const atual = monthRange(today, 0)
  const anterior = monthRange(today, -1)
  return {
    from: period.months.includes('anterior') ? anterior.from : atual.from,
    to: period.months.includes('atual') ? atual.to : anterior.to,
  }
}

function periodLabel(period: Period) {
  if (period.custom) return `${formatDate(period.custom.from).slice(0, 5)} a ${formatDate(period.custom.to).slice(0, 5)}`
  if (period.months.length === 2) return 'Mês atual e anterior'
  if (period.months[0] === 'atual') return 'Mês atual'
  if (period.months[0] === 'anterior') return 'Mês anterior'
  return null
}

/** Rótulo do botão de filtro: o nome do único escolhido ou a quantidade. */
function chipLabel(selected: string[], nameOf: (id: string) => string | undefined, empty: string, plural: string) {
  if (selected.length === 0) return empty
  if (selected.length === 1) return nameOf(selected[0]!) ?? empty
  return `${selected.length} ${plural}`
}

/** Digitação com as barras automáticas: "01092026" -> "01/09/2026". */
function maskDate(text: string) {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/')
}

/** DD/MM/AAAA -> AAAA-MM-DD, ou null se a data não existir. */
function parseDate(text: string) {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

/**
 * Auditoria de fotos: o vendedor audita fotos dos seus clientes; o supervisor, as da equipe
 * (e vê a decisão do vendedor em "Outras auditorias").
 */
export function PhotoAuditScreen() {
  const [status, setStatus] = useState<Status>('pendentes')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [options, setOptions] = useState<FilterOptions>({ clients: [], promotores: [] })
  const [picker, setPicker] = useState<'client' | 'promotor' | 'type' | 'period' | null>(null)
  const [items, setItems] = useState<AuditPhoto[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(
    async (targetPage: number, mode: 'reset' | 'more' | 'refresh') => {
      const id = ++requestId.current
      if (mode === 'more') setLoadingMore(true)
      if (mode === 'refresh') setRefreshing(true)
      try {
        const params = new URLSearchParams({ status, page: String(targetPage), pageSize: String(PAGE_SIZE) })
        if (filters.clientIds.length) params.set('clientId', filters.clientIds.join(','))
        if (filters.promotorIds.length) params.set('promotorId', filters.promotorIds.join(','))
        if (filters.types.length) params.set('type', filters.types.join(','))
        const dates = periodRange(filters.period, todayLocal())
        if (dates) {
          params.set('from', dates.from)
          params.set('to', dates.to)
        }
        const res = await api<Paged<AuditPhoto>>(`/audit/photos?${params.toString()}`)
        if (id !== requestId.current) return
        setItems((prev) => (mode === 'more' ? [...prev, ...res.items.filter((p) => !prev.some((x) => x.id === p.id))] : res.items))
        setTotal(res.total)
        setPage(targetPage)
        setError(null)
      } catch (e) {
        if (id === requestId.current) setError(errorMessage(e))
      } finally {
        if (id === requestId.current) {
          setLoading(false)
          setLoadingMore(false)
          setRefreshing(false)
        }
      }
    },
    [status, filters],
  )

  useEffect(() => {
    setLoading(true)
    setItems([])
    void load(1, 'reset')
  }, [load])

  const range = periodRange(filters.period, todayLocal())
  // a API amplia as opções até o início do período quando ele é mais antigo que o padrão
  const optionsFrom = range?.from
  useFocusEffect(
    useCallback(() => {
      api<FilterOptions>(`/audit/filters${optionsFrom ? `?from=${optionsFrom}` : ''}`)
        .then(setOptions)
        .catch(() => {})
    }, [optionsFrom]),
  )

  const current = items.find((p) => p.id === selected) ?? null

  function onAudited(updated: AuditPhoto) {
    emitBadgesChanged()
    if (status === 'pendentes') {
      const index = items.findIndex((p) => p.id === updated.id)
      const rest = items.filter((p) => p.id !== updated.id)
      setItems(rest)
      setTotal((t) => Math.max(0, t - 1))
      // segue para a próxima foto pendente
      setSelected(rest[index]?.id ?? rest[index - 1]?.id ?? null)
    } else {
      setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    }
  }

  const clientLabel = chipLabel(filters.clientIds, (id) => options.clients.find((c) => c.id === id)?.name, 'Cliente', 'clientes')
  const promotorLabel = chipLabel(filters.promotorIds, (id) => options.promotores.find((p) => p.id === id)?.name, 'Promotor', 'promotores')
  const typeLabel = chipLabel(filters.types, (t) => photoTypeLabels[t as PhotoType], 'Tipo', 'tipos')

  const header = (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pendentes', label: 'Pendentes' },
          { value: 'auditadas', label: 'Auditadas' },
          { value: 'todas', label: 'Todas' },
        ]}
      />
      <Row>
        <FilterChip label={periodLabel(filters.period) ?? 'Período'} active={!!range} onPress={() => setPicker('period')} />
        <FilterChip label={clientLabel} active={filters.clientIds.length > 0} onPress={() => setPicker('client')} />
        <FilterChip label={promotorLabel} active={filters.promotorIds.length > 0} onPress={() => setPicker('promotor')} />
        <FilterChip label={typeLabel} active={filters.types.length > 0} onPress={() => setPicker('type')} />
      </Row>
      <Muted>
        {total} foto(s) · {range ? `${formatDate(range.from)} a ${formatDate(range.to)}` : 'últimos 7 dias'}
      </Muted>
      {error ? <Banner tone="danger" text={error} /> : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} colors={[colors.primary]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loadingMore && !loading && items.length < total) void load(page + 1, 'more')
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <EmptyState title={status === 'pendentes' ? 'Nenhuma foto para auditar' : 'Nenhuma foto encontrada'} text="Puxe para baixo para atualizar." />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginTop: space.md }} /> : undefined}
        renderItem={({ item }) => <PhotoRow photo={item} onPress={() => setSelected(item.id)} />}
      />

      <PeriodSheet
        visible={picker === 'period'}
        period={filters.period}
        onChange={(period) => setFilters((f) => ({ ...f, period }))}
        onClose={() => setPicker(null)}
      />
      <MultiPickerSheet
        visible={picker === 'client'}
        title="Filtrar por cliente"
        allLabel="Todos os clientes"
        values={filters.clientIds}
        options={options.clients.map((c) => ({ value: c.id, label: c.name, detail: c.city ?? undefined }))}
        onChange={(clientIds) => setFilters((f) => ({ ...f, clientIds }))}
        onClose={() => setPicker(null)}
      />
      <MultiPickerSheet
        visible={picker === 'promotor'}
        title="Filtrar por promotor"
        allLabel="Todos os promotores"
        values={filters.promotorIds}
        options={options.promotores.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(promotorIds) => setFilters((f) => ({ ...f, promotorIds }))}
        onClose={() => setPicker(null)}
      />
      <MultiPickerSheet
        visible={picker === 'type'}
        title="Filtrar por tipo de foto"
        allLabel="Todos os tipos"
        values={filters.types}
        options={(Object.entries(photoTypeLabels) as [PhotoType, string][]).map(([value, label]) => ({ value, label }))}
        onChange={(types) => setFilters((f) => ({ ...f, types }))}
        onClose={() => setPicker(null)}
      />

      <PhotoViewer url={current?.url ?? null} visible={!!current} onClose={() => setSelected(null)}>
        {current ? <AuditPanel key={current.id} photo={current} onAudited={onAudited} /> : null}
      </PhotoViewer>
    </View>
  )
}

/**
 * Período das fotos: mês atual e mês anterior podem ser marcados juntos (os dois meses);
 * o período livre substitui os meses e só vale ao tocar em "Aplicar período".
 */
function PeriodSheet({ visible, period, onChange, onClose }: { visible: boolean; period: Period; onChange: (p: Period) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    if (!visible) return
    setCustom(!!period.custom)
    setFrom(period.custom ? formatDate(period.custom.from) : '')
    setTo(period.custom ? formatDate(period.custom.to) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const today = todayLocal()
  const atual = monthRange(today, 0)
  const anterior = monthRange(today, -1)
  const fromIso = parseDate(from)
  const toIso = parseDate(to)
  const fromError = from.length === 10 && !fromIso ? 'Data inválida' : null
  const toError = to.length === 10 && !toIso ? 'Data inválida' : null
  const orderError = fromIso && toIso && fromIso > toIso ? 'A data inicial é depois da final.' : null

  function toggleMonth(month: Month) {
    const months = !custom && period.months.includes(month) ? period.months.filter((m) => m !== month) : [...(custom ? [] : period.months), month]
    setCustom(false)
    onChange({ months, custom: null })
  }

  function toggleCustom() {
    if (!custom) return setCustom(true)
    setCustom(false)
    if (period.custom) onChange({ months: [], custom: null })
  }

  return (
    <Sheet visible={visible} title="Filtrar por período" onClose={onClose}>
      <CheckOption
        label="Últimos 7 dias"
        detail="Padrão"
        checked={!custom && !period.custom && period.months.length === 0}
        onPress={() => {
          setCustom(false)
          onChange({ months: [], custom: null })
        }}
      />
      <CheckOption label="Mês atual" detail={`${formatDate(atual.from)} a ${formatDate(atual.to)}`} checked={!custom && period.months.includes('atual')} onPress={() => toggleMonth('atual')} />
      <CheckOption label="Mês anterior" detail={`${formatDate(anterior.from)} a ${formatDate(anterior.to)}`} checked={!custom && period.months.includes('anterior')} onPress={() => toggleMonth('anterior')} />
      <CheckOption label="Período livre" detail="Escolha a data de início e a de fim" checked={custom} onPress={toggleCustom} />
      {custom ? (
        <>
          <Row style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Field label="De" value={from} onChangeText={(t) => setFrom(maskDate(t))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} error={fromError} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Até" value={to} onChangeText={(t) => setTo(maskDate(t))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} error={toError} />
            </View>
          </Row>
          {orderError ? <Banner tone="danger" text={orderError} /> : null}
          <Button
            title="Aplicar período"
            disabled={!fromIso || !toIso || !!orderError}
            onPress={() => {
              if (!fromIso || !toIso) return
              onChange({ months: [], custom: { from: fromIso, to: toIso } })
              onClose()
            }}
          />
        </>
      ) : null}
    </Sheet>
  )
}

function PhotoRow({ photo, onPress }: { photo: AuditPhoto; onPress: () => void }) {
  const mine = photo.myAudit ? auditStatusInfo[photo.myAudit.status] : null
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
      <Image source={{ uri: resolveUrl(photo.url) }} style={{ width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.neutralSoft }} contentFit="cover" />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.text, { fontWeight: '700' }]} numberOfLines={1}>
          {photo.client.name}
        </Text>
        <Muted>
          {photoTypeLabels[photo.type]} · {formatDate(photo.visit.date)} {formatTime(photo.takenAt)}
        </Muted>
        <Muted>Promotor: {photo.promotor.name}</Muted>
        <Row>
          {mine ? <Badge label={`Você: ${mine.label}`} color={mine.color} bg={mine.bg} /> : <Badge label="Pendente" color={colors.warning} bg={colors.warningSoft} />}
          {photo.otherAudits.map((a) => (
            <Badge key={a.id} label={`${a.auditor.name.split(' ')[0]}: ${auditStatusInfo[a.status].label}`} color={auditStatusInfo[a.status].color} bg={colors.neutralSoft} />
          ))}
        </Row>
      </View>
    </Card>
  )
}

function AuditLine({ audit, title }: { audit: Audit; title: string }) {
  const info = auditStatusInfo[audit.status]
  return (
    <Card style={{ padding: space.md }}>
      <Row>
        <Text style={[styles.text, { fontWeight: '700' }]}>{title}</Text>
        <Badge label={info.label} color={info.color} bg={info.bg} />
      </Row>
      {audit.justification ? <Text style={styles.text}>"{audit.justification}"</Text> : null}
      {audit.review ? (
        <Muted>
          Conferida por {audit.review.supervisor.name}: {audit.review.verdict === 'CORRETA' ? 'correta' : 'incorreta'}
          {audit.review.comment ? ` - ${audit.review.comment}` : ''}
        </Muted>
      ) : null}
    </Card>
  )
}

function AuditPanel({ photo, onAudited }: { photo: AuditPhoto; onAudited: (p: AuditPhoto) => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [justification, setJustification] = useState('')
  const [busy, setBusy] = useState<'APROVADA' | 'REPROVADA' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = !!photo.myAudit?.review
  const meta = photo.meta ? Object.entries(photo.meta).map(([k, v]) => `${k}: ${v}`).join(' · ') : null

  async function submit(statusValue: 'APROVADA' | 'REPROVADA') {
    setBusy(statusValue)
    setError(null)
    try {
      const updated = await api<AuditPhoto>(`/audit/photos/${photo.id}`, {
        body: { status: statusValue, justification: statusValue === 'REPROVADA' ? justification.trim() : undefined },
      })
      onAudited(updated)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Text style={styles.sectionTitle}>{photo.client.name}</Text>
      <Muted>
        {photoTypeLabels[photo.type]} · {formatDate(photo.visit.date)} às {formatTime(photo.takenAt)} · {photo.promotor.name}
      </Muted>
      {meta ? <Muted>{meta}</Muted> : null}
      {photo.notes ? <Text style={styles.text}>{photo.notes}</Text> : null}
      {photo.products?.length ? <Muted>Produtos marcados pelo promotor: {photo.products.map((p) => p.name).join(', ')}</Muted> : null}
      {photo.otherAudits.map((a) => (
        <AuditLine key={a.id} audit={a} title={`${a.auditor.name} (${a.auditor.role === 'VENDEDOR' ? 'vendedor' : 'supervisor'})`} />
      ))}
      {photo.myAudit ? <AuditLine audit={photo.myAudit} title="Sua auditoria" /> : null}

      {locked ? (
        <Banner tone="info" text="Sua auditoria já foi conferida pelo supervisor e não pode mais ser alterada." />
      ) : rejecting ? (
        <>
          <Field label="Por que a foto está reprovada?" value={justification} onChangeText={setJustification} multiline placeholder="Ex.: foto escura, gôndola desorganizada" hint="Mínimo de 5 caracteres" />
          <Row>
            <Button title="Voltar" variant="secondary" onPress={() => setRejecting(false)} style={{ flex: 1 }} />
            <Button title="Reprovar" variant="danger" onPress={() => submit('REPROVADA')} loading={busy === 'REPROVADA'} disabled={justification.trim().length < 5} style={{ flex: 1 }} />
          </Row>
        </>
      ) : (
        <Row>
          <Button title="Reprovar" variant="danger" onPress={() => setRejecting(true)} style={{ flex: 1 }} />
          <Button title="Aprovar" variant="success" onPress={() => submit('APROVADA')} loading={busy === 'APROVADA'} style={{ flex: 1 }} />
        </Row>
      )}
      {error ? <Banner tone="danger" text={error} /> : null}
    </>
  )
}
