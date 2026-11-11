import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, Text, View } from 'react-native'
import { Badge, Banner, Button, Card, DecisionPair, EmptyState, Field, Muted, PickerSheet, Row, Segmented, styles } from '@/components/ui'
import { FilterChip } from '@/features/audit/FilterChip'
import { PhotoViewer, useViewerTyping, ViewerFooter, ViewerInfo } from '@/features/PhotoViewer'
import { api, errorMessage } from '@/lib/api'
import { resolveUrl } from '@/lib/config'
import { emitBadgesChanged } from '@/lib/events'
import { auditStatusInfo, formatDate, formatDateTime, formatTime, MIN_JUSTIFICATION, photoTypeLabels, reviewPendingInfo, reviewVerdictInfo } from '@/lib/format'
import { colors, radius, sizes, space } from '@/lib/theme'
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

  // Depois de conferir, a próxima abre sozinha (em qualquer filtro)
  function onReviewed(updated: VendorAudit) {
    emitBadgesChanged()
    const index = items.findIndex((a) => a.id === updated.id)
    if (state === 'pendentes') {
      const rest = items.filter((a) => a.id !== updated.id)
      setItems(rest)
      setTotal((t) => Math.max(0, t - 1))
      setSelected(rest[index]?.id ?? rest[index - 1]?.id ?? null)
      if (!rest[index] && rest.length < total - 1) void load(page + 1, 'more')
    } else {
      setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      setSelected(items[index + 1]?.id ?? null)
      if (!items[index + 1] && items.length < total) void load(page + 1, 'more')
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
    <View style={{ flex: 1, backgroundColor: colors.fundo }}>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + space.sm }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} colors={[colors.marinho]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loadingMore && !loading && items.length < total) void load(page + 1, 'more')
        }}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.marinho} style={{ marginTop: space.xxl + space.sm }} /> : <EmptyState title={state === 'pendentes' ? 'Tudo conferido' : 'Nenhuma auditoria encontrada'} />
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.marinho} style={{ marginTop: space.md }} /> : undefined}
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

      <PhotoViewer url={current?.photo.url ?? null} visible={!!current} onClose={() => setSelected(null)} slots>
        {current ? <ReviewPanel key={current.id} audit={current} onReviewed={onReviewed} /> : null}
      </PhotoViewer>
    </View>
  )
}

function AuditRow({ audit, onPress }: { audit: VendorAudit; onPress: () => void }) {
  const info = auditStatusInfo[audit.status]
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
      <Image
        source={{ uri: resolveUrl(audit.photo.url) }}
        style={{ width: sizes.miniatura, height: sizes.miniatura, borderRadius: radius.sm, backgroundColor: colors.neutroSuave }}
        contentFit="cover"
      />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {audit.vendedor.name}
        </Text>
        <Muted numberOfLines={1}>
          {audit.client.name} · {photoTypeLabels[audit.photo.type]}
        </Muted>
        <Row>
          <Badge label={`Vendedor: ${info.label}`} tone={info.tone} />
          {audit.review ? (
            <Badge label={reviewVerdictInfo[audit.review.verdict].label} tone={reviewVerdictInfo[audit.review.verdict].tone} />
          ) : (
            <Badge label={reviewPendingInfo.label} tone={reviewPendingInfo.tone} />
          )}
        </Row>
        {audit.justification ? <Muted numberOfLines={1}>"{audit.justification}"</Muted> : null}
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
    Keyboard.dismiss()
    setBusy(verdict)
    setError(null)
    try {
      const updated = await api<VendorAudit>(`/supervisor/vendor-audits/${audit.id}/review`, {
        // A explicação é da conferência incorreta (é ela que vai no PDF do vendedor)
        body: { verdict, comment: verdict === 'INCORRETA' ? comment.trim() : undefined },
      })
      onReviewed(updated)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  // Escrevendo a justificativa, a caixa vai para o alto do visualizador e o teclado abre abaixo dela
  useViewerTyping(marking)
  const stopMarking = () => {
    Keyboard.dismiss()
    setMarking(false)
  }

  // Escrevendo a explicação: caixa e botões no alto da folha. Senão, decisão no rodapé fixo.
  const markForm = (
    <>
      <Field
        label={`O que o vendedor errou? (a foto deveria ser ${correct})`}
        value={comment}
        onChangeText={setComment}
        multiline
        autoFocus
        hint={`Mínimo de ${MIN_JUSTIFICATION} caracteres. Vai no PDF de correções para o vendedor.`}
      />
      <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Button title="Voltar" variant="secondary" onPress={stopMarking} style={{ flex: 1 }} />
        <Button
          title="Marcar incorreta"
          variant="reject"
          onPress={() => submit('INCORRETA')}
          loading={busy === 'INCORRETA'}
          disabled={comment.trim().length < MIN_JUSTIFICATION}
          missing={`Escreva pelo menos ${MIN_JUSTIFICATION} caracteres`}
          style={{ flex: 1 }}
        />
      </Row>
    </>
  )

  return (
    <>
      <ViewerInfo>
        {marking ? markForm : null}
        {error ? <Banner tone="danger" text={error} /> : null}
        <Text style={styles.sectionTitle}>{audit.client.name}</Text>
        <Muted>
          {photoTypeLabels[audit.photo.type]} · visita {formatDate(audit.visit.date)} às {formatTime(audit.photo.takenAt)} · {audit.promotor.name}
        </Muted>
        {audit.photo.products?.length ? <Muted>Produtos marcados pelo promotor: {audit.photo.products.map((p) => p.name).join(', ')}</Muted> : null}
        <Card style={{ padding: space.md }}>
          <Row>
            <Text style={styles.optionText}>{audit.vendedor.name}</Text>
            <Badge label={info.label} tone={info.tone} />
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
      </ViewerInfo>
      {marking ? null : (
        <ViewerFooter>
          <DecisionPair
            negative={{ title: 'Incorreta', onPress: () => setMarking(true), disabled: !!busy }}
            positive={{ title: 'Correta', onPress: () => submit('CORRETA'), loading: busy === 'CORRETA' }}
          />
        </ViewerFooter>
      )}
    </>
  )
}
