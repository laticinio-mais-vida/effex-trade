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
import { auditStatusInfo, formatDate, formatDateTime, formatTime, photoTypeLabels } from '@/lib/format'
import { colors, radius, space } from '@/lib/theme'
import type { Paged, Team, VendorAudit } from '@/lib/types'

type State = 'pendentes' | 'conferidas' | 'todas'
const PAGE_SIZE = 20

/** Supervisor confere as auditorias feitas pelos vendedores (correta / incorreta). */
export function VendorAuditScreen() {
  const [state, setState] = useState<State>('pendentes')
  const [vendedorId, setVendedorId] = useState<string | null>(null)
  const [vendedores, setVendedores] = useState<Team['vendedores']>([])
  const [picker, setPicker] = useState(false)
  const [items, setItems] = useState<VendorAudit[]>([])
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
        const params = new URLSearchParams({ state, page: String(targetPage), pageSize: String(PAGE_SIZE) })
        if (vendedorId) params.set('vendedorId', vendedorId)
        const res = await api<Paged<VendorAudit>>(`/supervisor/vendor-audits?${params.toString()}`)
        if (id !== requestId.current) return
        setItems((prev) => (mode === 'more' ? [...prev, ...res.items.filter((a) => !prev.some((x) => x.id === a.id))] : res.items))
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
    [state, vendedorId],
  )

  useEffect(() => {
    setLoading(true)
    setItems([])
    void load(1, 'reset')
  }, [load])

  useFocusEffect(
    useCallback(() => {
      api<Team>('/supervisor/team')
        .then((t) => setVendedores(t.vendedores))
        .catch(() => {})
    }, []),
  )

  const current = items.find((a) => a.id === selected) ?? null

  function onReviewed(updated: VendorAudit) {
    emitBadgesChanged()
    if (state === 'pendentes') {
      const index = items.findIndex((a) => a.id === updated.id)
      const rest = items.filter((a) => a.id !== updated.id)
      setItems(rest)
      setTotal((t) => Math.max(0, t - 1))
      setSelected(rest[index]?.id ?? rest[index - 1]?.id ?? null)
    } else {
      setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    }
  }

  const header = (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <Segmented
        value={state}
        onChange={setState}
        options={[
          { value: 'pendentes', label: 'A conferir' },
          { value: 'conferidas', label: 'Conferidas' },
          { value: 'todas', label: 'Todas' },
        ]}
      />
      <Row>
        <FilterChip label={vendedores.find((v) => v.id === vendedorId)?.name ?? 'Vendedor'} active={!!vendedorId} onPress={() => setPicker(true)} />
      </Row>
      <Muted>{total} auditoria(s) de vendedores · últimos 30 dias</Muted>
      {error ? <Banner tone="danger" text={error} /> : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} colors={[colors.primary]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loadingMore && !loading && items.length < total) void load(page + 1, 'more')
        }}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : <EmptyState title={state === 'pendentes' ? 'Tudo conferido' : 'Nenhuma auditoria encontrada'} />
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginTop: space.md }} /> : undefined}
        renderItem={({ item }) => <AuditRow audit={item} onPress={() => setSelected(item.id)} />}
      />

      <PickerSheet
        visible={picker}
        title="Filtrar por vendedor"
        value={vendedorId ?? '__all'}
        options={[
          { value: '__all', label: 'Todos os vendedores' },
          ...vendedores.map((v) => ({ value: v.id, label: v.name, detail: v.pendingReviews > 0 ? `${v.pendingReviews} a conferir` : undefined })),
        ]}
        onSelect={(v) => setVendedorId(v === '__all' ? null : v)}
        onClose={() => setPicker(false)}
      />

      <PhotoViewer url={current?.photo.url ?? null} visible={!!current} onClose={() => setSelected(null)}>
        {current ? <ReviewPanel key={current.id} audit={current} onReviewed={onReviewed} /> : null}
      </PhotoViewer>
    </View>
  )
}

function AuditRow({ audit, onPress }: { audit: VendorAudit; onPress: () => void }) {
  const info = auditStatusInfo[audit.status]
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
      <Image source={{ uri: resolveUrl(audit.photo.url) }} style={{ width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.neutralSoft }} contentFit="cover" />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.text, { fontWeight: '700' }]} numberOfLines={1}>
          {audit.vendedor.name}
        </Text>
        <Muted numberOfLines={1}>
          {audit.client.name} · {photoTypeLabels[audit.photo.type]}
        </Muted>
        <Row>
          <Badge label={info.label} color={info.color} bg={info.bg} />
          {audit.review ? (
            <Badge
              label={audit.review.verdict === 'CORRETA' ? 'Correta' : 'Incorreta'}
              color={audit.review.verdict === 'CORRETA' ? colors.success : colors.danger}
              bg={colors.neutralSoft}
            />
          ) : null}
        </Row>
        {audit.justification ? (
          <Muted numberOfLines={1} style={{ fontStyle: 'italic' }}>
            "{audit.justification}"
          </Muted>
        ) : null}
      </View>
    </Card>
  )
}

function ReviewPanel({ audit, onReviewed }: { audit: VendorAudit; onReviewed: (a: VendorAudit) => void }) {
  const [marking, setMarking] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'CORRETA' | 'INCORRETA' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const info = auditStatusInfo[audit.status]
  const correct = audit.status === 'APROVADA' ? 'reprovada' : 'aprovada'

  async function submit(verdict: 'CORRETA' | 'INCORRETA') {
    setBusy(verdict)
    setError(null)
    try {
      const updated = await api<VendorAudit>(`/supervisor/vendor-audits/${audit.id}/review`, {
        body: { verdict, comment: comment.trim() || undefined },
      })
      onReviewed(updated)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Text style={styles.sectionTitle}>{audit.client.name}</Text>
      <Muted>
        {photoTypeLabels[audit.photo.type]} · visita {formatDate(audit.visit.date)} às {formatTime(audit.photo.takenAt)} · {audit.promotor.name}
      </Muted>
      {audit.photo.products?.length ? <Muted>Produtos marcados pelo promotor: {audit.photo.products.map((p) => p.name).join(', ')}</Muted> : null}
      <Card style={{ padding: space.md }}>
        <Row>
          <Text style={[styles.text, { fontWeight: '700' }]}>{audit.vendedor.name}</Text>
          <Badge label={info.label} color={info.color} bg={info.bg} />
        </Row>
        {audit.justification ? <Text style={styles.text}>"{audit.justification}"</Text> : null}
        <Muted>Auditada em {formatDateTime(audit.createdAt)}</Muted>
      </Card>
      {audit.review ? (
        <Banner
          tone={audit.review.verdict === 'CORRETA' ? 'success' : 'danger'}
          text={`Você marcou como ${audit.review.verdict === 'CORRETA' ? 'correta' : 'incorreta'}${audit.review.comment ? `: ${audit.review.comment}` : ''}. Pode alterar abaixo.`}
        />
      ) : null}
      {marking ? (
        <>
          <Field
            label={`O que o vendedor errou? (a foto deveria ser ${correct})`}
            value={comment}
            onChangeText={setComment}
            multiline
            hint="Mínimo de 5 caracteres. Vai no PDF de correções para o vendedor."
          />
          <Row>
            <Button title="Voltar" variant="secondary" onPress={() => setMarking(false)} style={{ flex: 1 }} />
            <Button title="Marcar incorreta" variant="danger" onPress={() => submit('INCORRETA')} loading={busy === 'INCORRETA'} disabled={comment.trim().length < 5} style={{ flex: 1 }} />
          </Row>
        </>
      ) : (
        <Row>
          <Button title="Incorreta" variant="danger" onPress={() => setMarking(true)} style={{ flex: 1 }} />
          <Button title="Correta" variant="success" onPress={() => submit('CORRETA')} loading={busy === 'CORRETA'} style={{ flex: 1 }} />
        </Row>
      )}
      {error ? <Banner tone="danger" text={error} /> : null}
    </>
  )
}
