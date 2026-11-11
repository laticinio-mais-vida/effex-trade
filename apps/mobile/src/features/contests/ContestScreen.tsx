import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Keyboard, RefreshControl, Text, View } from 'react-native'
import { Badge, Banner, Button, Card, DecisionPair, EmptyState, Field, Muted, Row, Segmented, styles } from '@/components/ui'
import { PhotoViewer, useViewerTyping, ViewerFooter, ViewerInfo } from '@/features/PhotoViewer'
import { api, errorMessage } from '@/lib/api'
import { resolveUrl } from '@/lib/config'
import { emitBadgesChanged } from '@/lib/events'
import { auditStatusInfo, contestStatusInfo, formatDate, formatDateTime, formatTime, MIN_JUSTIFICATION, photoTypeLabels, roleLabels } from '@/lib/format'
import { borders, colors, radius, sizes, space } from '@/lib/theme'
import type { Paged, SupervisorContest } from '@/lib/types'

type State = 'pendentes' | 'decididas' | 'todas'
const PAGE_SIZE = 20

/** Supervisor decide as contestações dos promotores da equipe sobre fotos reprovadas. */
export function ContestScreen() {
  const [state, setState] = useState<State>('pendentes')
  const [items, setItems] = useState<SupervisorContest[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(
    async (targetPage: number, mode: 'reset' | 'more' | 'refresh' | 'silent') => {
      const id = ++requestId.current
      if (mode === 'more') setLoadingMore(true)
      if (mode === 'refresh') setRefreshing(true)
      try {
        const params = new URLSearchParams({ state, page: String(targetPage), pageSize: String(PAGE_SIZE) })
        const res = await api<Paged<SupervisorContest>>(`/supervisor/contests?${params.toString()}`)
        if (id !== requestId.current) return
        setItems((prev) => (mode === 'more' ? [...prev, ...res.items.filter((c) => !prev.some((x) => x.id === c.id))] : res.items))
        setTotal(res.total)
        setPage(targetPage)
        setError(null)
      } catch (e) {
        if (id === requestId.current && mode !== 'silent') setError(errorMessage(e))
      } finally {
        if (id === requestId.current) {
          setLoading(false)
          setLoadingMore(false)
          setRefreshing(false)
        }
      }
    },
    [state],
  )

  useEffect(() => {
    setLoading(true)
    setItems([])
    void load(1, 'reset')
  }, [load])

  // Contestação nova chega enquanto o supervisor está em outra aba: atualiza ao voltar (sem fechar a foto aberta)
  useFocusEffect(
    useCallback(() => {
      if (!selected) void load(1, 'silent')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  )

  const current = items.find((c) => c.id === selected) ?? null

  // Depois de decidir, a próxima contestação abre sozinha (em qualquer filtro)
  function onDecided(updated: SupervisorContest) {
    emitBadgesChanged()
    const index = items.findIndex((c) => c.id === updated.id)
    if (state === 'pendentes') {
      const rest = items.filter((c) => c.id !== updated.id)
      setItems(rest)
      setTotal((t) => Math.max(0, t - 1))
      setSelected(rest[index]?.id ?? rest[index - 1]?.id ?? null)
      if (!rest[index] && rest.length < total - 1) void load(page + 1, 'more')
    } else {
      setItems((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
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
          { value: 'pendentes', label: 'Aguardando' },
          { value: 'decididas', label: 'Decididas' },
          { value: 'todas', label: 'Todas' },
        ]}
      />
      <Muted>
        {total} contestação(ões). O promotor contesta até 2 fotos reprovadas por dia. Aceitar aprova a foto; negar exige uma resposta para ele.
      </Muted>
      {error ? <Banner tone="danger" text={error} /> : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.fundo }}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + space.sm }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} colors={[colors.marinho]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loadingMore && !loading && items.length < total) void load(page + 1, 'more')
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.marinho} style={{ marginTop: space.xxl + space.sm }} />
          ) : (
            <EmptyState title={state === 'pendentes' ? 'Nenhuma contestação esperando' : 'Nenhuma contestação'} />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.marinho} style={{ marginTop: space.md }} /> : undefined}
        renderItem={({ item }) => <ContestRow contest={item} onPress={() => setSelected(item.id)} />}
      />

      <PhotoViewer url={current?.photo.url ?? null} visible={!!current} onClose={() => setSelected(null)} slots>
        {current ? <DecidePanel key={current.id} contest={current} onDecided={onDecided} /> : null}
      </PhotoViewer>
    </View>
  )
}

function ContestRow({ contest, onPress }: { contest: SupervisorContest; onPress: () => void }) {
  const info = contestStatusInfo[contest.status]
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
      <Image
        source={{ uri: resolveUrl(contest.photo.url) }}
        style={{ width: sizes.miniatura, height: sizes.miniatura, borderRadius: radius.sm, backgroundColor: colors.neutroSuave }}
        contentFit="cover"
      />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {contest.promotor.name}
        </Text>
        <Muted numberOfLines={1}>
          {contest.client.name} · {photoTypeLabels[contest.photo.type]} · {formatDate(contest.visit.date)}
        </Muted>
        <Text style={styles.text} numberOfLines={2}>
          "{contest.reason}"
        </Text>
        <Row>
          <Badge label={contest.status === 'PENDENTE' ? 'Aguardando decisão' : info.label} tone={info.tone} />
        </Row>
      </View>
    </Card>
  )
}

function DecidePanel({ contest, onDecided }: { contest: SupervisorContest; onDecided: (c: SupervisorContest) => void }) {
  const [denying, setDenying] = useState(false)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState<'ACEITA' | 'NEGADA' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = contest.status === 'PENDENTE'

  // Escrevendo a resposta, a caixa vai para o alto do visualizador e o teclado abre abaixo dela
  useViewerTyping(denying)

  async function decide(decision: 'ACEITA' | 'NEGADA') {
    Keyboard.dismiss()
    setBusy(decision)
    setError(null)
    try {
      const updated = await api<SupervisorContest>(`/supervisor/contests/${contest.id}/decide`, {
        body: { decision, response: decision === 'NEGADA' ? response.trim() : undefined },
      })
      setDenying(false)
      onDecided(updated)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  function confirmAccept() {
    Alert.alert('Aceitar a contestação?', 'A foto passa a valer como aprovada. Se quem reprovou foi o vendedor, a auditoria dele fica como incorreta.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Aceitar', onPress: () => void decide('ACEITA') },
    ])
  }

  const stop = () => {
    Keyboard.dismiss()
    setDenying(false)
  }

  const denyForm = (
    <>
      <Field
        label="Por que a reprovação continua?"
        value={response}
        onChangeText={setResponse}
        multiline
        autoFocus
        placeholder="Ex.: a foto não mostra os preços; tire de mais longe"
        hint={`Mínimo de ${MIN_JUSTIFICATION} caracteres. O promotor vê esta resposta.`}
      />
      <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Button title="Voltar" variant="secondary" onPress={stop} style={{ flex: 1 }} />
        <Button
          title="Negar"
          variant="reject"
          onPress={() => decide('NEGADA')}
          loading={busy === 'NEGADA'}
          disabled={response.trim().length < MIN_JUSTIFICATION}
          missing={`Escreva pelo menos ${MIN_JUSTIFICATION} caracteres`}
          style={{ flex: 1 }}
        />
      </Row>
    </>
  )

  return (
    <>
      <ViewerInfo>
        {denying ? denyForm : null}
        {error ? <Banner tone="danger" text={error} /> : null}
        <Text style={styles.sectionTitle}>{contest.client.name}</Text>
        <Muted>
          {photoTypeLabels[contest.photo.type]} · {formatDate(contest.visit.date)} às {formatTime(contest.photo.takenAt)} · {contest.promotor.name}
        </Muted>
        {contest.audits.map((a) => {
          const info = auditStatusInfo[a.status]
          return (
            <Card key={a.id} style={{ padding: space.md }}>
              <Row>
                <Text style={styles.optionText}>
                  {a.auditor.name} ({roleLabels[a.auditor.role]})
                </Text>
                <Badge label={info.label} tone={info.tone} />
              </Row>
              {a.justification ? <Text style={styles.text}>"{a.justification}"</Text> : null}
              {a.review ? (
                <Muted>
                  Conferida por {a.review.supervisor.name}: {a.review.verdict === 'CORRETA' ? 'correta' : 'incorreta'}
                  {a.review.comment ? ` - ${a.review.comment}` : ''}
                </Muted>
              ) : null}
            </Card>
          )
        })}
        <Card style={{ padding: space.md, borderColor: colors.marinho, borderWidth: borders.campo }}>
          <Text style={styles.optionText}>Contestação de {contest.promotor.name}</Text>
          <Text style={styles.text}>"{contest.reason}"</Text>
          <Muted>Enviada em {formatDateTime(contest.createdAt)}</Muted>
        </Card>
        {!pending ? (
          <Banner
            tone={contest.status === 'ACEITA' ? 'success' : 'danger'}
            text={`${contest.status === 'ACEITA' ? 'Aceita' : 'Negada'} por ${contest.decidedBy?.name ?? '—'} em ${formatDateTime(contest.decidedAt)}.${contest.response ? `\n${contest.response}` : ''}`}
          />
        ) : null}
      </ViewerInfo>
      {pending && !denying ? (
        <ViewerFooter>
          <DecisionPair
            negative={{ title: 'Negar', onPress: () => setDenying(true), disabled: !!busy }}
            positive={{ title: 'Aceitar', onPress: confirmAccept, loading: busy === 'ACEITA' }}
          />
        </ViewerFooter>
      ) : null}
    </>
  )
}
