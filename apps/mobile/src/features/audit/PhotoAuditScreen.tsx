import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native'
import { Badge, Banner, Button, Card, EmptyState, Field, Muted, PickerSheet, Row, Segmented, styles } from '@/components/ui'
import { FilterChip } from '@/features/audit/FilterChip'
import { PhotoViewer } from '@/features/PhotoViewer'
import { api, errorMessage } from '@/lib/api'
import { resolveUrl } from '@/lib/config'
import { emitBadgesChanged } from '@/lib/events'
import { auditStatusInfo, formatDate, formatTime, photoTypeLabels } from '@/lib/format'
import { colors, radius, space } from '@/lib/theme'
import type { Audit, AuditPhoto, Paged, PhotoType } from '@/lib/types'

type Status = 'pendentes' | 'auditadas' | 'todas'
type Filters = { clientId: string | null; promotorId: string | null; type: PhotoType | null }
type FilterOptions = { clients: { id: string; name: string; code: string | null }[]; promotores: { id: string; name: string }[] }

const PAGE_SIZE = 20

/**
 * Auditoria de fotos: o vendedor audita fotos dos seus clientes; o supervisor, as da equipe
 * (e vê a decisão do vendedor em "Outras auditorias").
 */
export function PhotoAuditScreen() {
  const [status, setStatus] = useState<Status>('pendentes')
  const [filters, setFilters] = useState<Filters>({ clientId: null, promotorId: null, type: null })
  const [options, setOptions] = useState<FilterOptions>({ clients: [], promotores: [] })
  const [picker, setPicker] = useState<'client' | 'promotor' | 'type' | null>(null)
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
        if (filters.clientId) params.set('clientId', filters.clientId)
        if (filters.promotorId) params.set('promotorId', filters.promotorId)
        if (filters.type) params.set('type', filters.type)
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

  useFocusEffect(
    useCallback(() => {
      api<FilterOptions>('/audit/filters')
        .then(setOptions)
        .catch(() => {})
    }, []),
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

  const clientLabel = options.clients.find((c) => c.id === filters.clientId)?.name
  const promotorLabel = options.promotores.find((p) => p.id === filters.promotorId)?.name

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
        <FilterChip label={clientLabel ?? 'Cliente'} active={!!filters.clientId} onPress={() => setPicker('client')} />
        <FilterChip label={promotorLabel ?? 'Promotor'} active={!!filters.promotorId} onPress={() => setPicker('promotor')} />
        <FilterChip label={filters.type ? photoTypeLabels[filters.type] : 'Tipo'} active={!!filters.type} onPress={() => setPicker('type')} />
      </Row>
      <Muted>
        {total} foto(s) · últimos 7 dias
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

      <PickerSheet
        visible={picker === 'client'}
        title="Filtrar por cliente"
        value={filters.clientId ?? '__all'}
        options={[{ value: '__all', label: 'Todos os clientes' }, ...options.clients.map((c) => ({ value: c.id, label: c.name, detail: c.code ?? undefined }))]}
        onSelect={(v) => setFilters((f) => ({ ...f, clientId: v === '__all' ? null : v }))}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === 'promotor'}
        title="Filtrar por promotor"
        value={filters.promotorId ?? '__all'}
        options={[{ value: '__all', label: 'Todos os promotores' }, ...options.promotores.map((p) => ({ value: p.id, label: p.name }))]}
        onSelect={(v) => setFilters((f) => ({ ...f, promotorId: v === '__all' ? null : v }))}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === 'type'}
        title="Filtrar por tipo de foto"
        value={filters.type ?? '__all'}
        options={[{ value: '__all', label: 'Todos os tipos' }, ...Object.entries(photoTypeLabels).map(([value, label]) => ({ value, label }))]}
        onSelect={(v) => setFilters((f) => ({ ...f, type: v === '__all' ? null : (v as PhotoType) }))}
        onClose={() => setPicker(null)}
      />

      <PhotoViewer url={current?.url ?? null} visible={!!current} onClose={() => setSelected(null)}>
        {current ? <AuditPanel key={current.id} photo={current} onAudited={onAudited} /> : null}
      </PhotoViewer>
    </View>
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
