import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Keyboard, Text, View } from 'react-native'
import { Badge, Banner, Button, Card, EmptyState, ErrorView, Field, LoadingView, Muted, Row, Screen, styles } from '@/components/ui'
import { PhotoViewer, useViewerTyping } from '@/features/PhotoViewer'
import { api, errorMessage } from '@/lib/api'
import { resolveUrl } from '@/lib/config'
import { contestStatusInfo, formatDate, formatDateTime, formatTime, photoTypeLabels, roleLabels } from '@/lib/format'
import { colors, radius, space } from '@/lib/theme'
import type { ContestInfo, RejectedList, RejectedPhoto } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

const MIN_REASON = 5

/** Aba Recusadas do promotor: fotos reprovadas dos últimos 14 dias, com as justificativas, e a contestação. */
export function RejectedScreen() {
  const { data, setData, error, loading, refreshing, refresh, reload } = useQuery(() => api<RejectedList>('/promotor/rejected'))
  const [selected, setSelected] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  if (loading && !data) return <LoadingView />
  if (error && !data) return <ErrorView message={error} onRetry={refresh} />

  const items = data?.items ?? []
  const current = items.find((p) => p.id === selected) ?? null
  const remaining = data?.remainingToday ?? 0

  function onContested(res: { item: RejectedPhoto; remainingToday: number }) {
    setData((d) => (d ? { ...d, remainingToday: res.remainingToday, usedToday: d.limitPerDay - res.remainingToday, items: d.items.map((p) => (p.id === res.item.id ? res.item : p)) } : d))
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Muted>
          Suas fotos reprovadas nos últimos {data?.windowDays ?? 14} dias. Se a foto estiver certa, conteste explicando o motivo: até {data?.limitPerDay ?? 2} por dia. O
          supervisor decide; se aceitar, a foto passa a valer como aprovada.
        </Muted>
        <Banner
          tone={remaining > 0 ? 'info' : 'warning'}
          text={remaining > 0 ? `Hoje você ainda pode contestar ${remaining} ${remaining === 1 ? 'foto' : 'fotos'}.` : 'Você já usou as contestações de hoje. Amanhã pode contestar outras.'}
        />
        {items.length === 0 ? <EmptyState title="Nenhuma foto reprovada" text="Quando uma foto sua for reprovada, ela aparece aqui com a justificativa." /> : null}
        {items.map((p) => (
          <RejectedRow key={p.id} photo={p} onPress={() => setSelected(p.id)} />
        ))}
      </Screen>
      <PhotoViewer url={current?.url ?? null} visible={!!current} onClose={() => setSelected(null)}>
        {current ? <ContestPanel key={current.id} photo={current} remaining={remaining} onContested={onContested} /> : null}
      </PhotoViewer>
    </View>
  )
}

function RejectedRow({ photo, onPress }: { photo: RejectedPhoto; onPress: () => void }) {
  const first = photo.rejections[0]
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
        {first?.justification ? (
          <Text style={styles.text} numberOfLines={2}>
            "{first.justification}"
          </Text>
        ) : null}
        <Row>
          {photo.contest ? <ContestBadge contest={photo.contest} /> : null}
          {photo.canContest ? <Badge label="Pode contestar" color={colors.info} bg={colors.infoSoft} /> : null}
        </Row>
      </View>
    </Card>
  )
}

function ContestBadge({ contest }: { contest: ContestInfo }) {
  const info = contestStatusInfo[contest.status]
  return <Badge label={info.label} color={info.color} bg={info.bg} />
}

function ContestResult({ contest }: { contest: ContestInfo }) {
  if (contest.status === 'PENDENTE') {
    return <Banner tone="warning" text={`Contestação enviada em ${formatDateTime(contest.createdAt)}, aguardando o supervisor.\nSua explicação: "${contest.reason}"`} />
  }
  if (contest.status === 'ACEITA') {
    return (
      <Banner
        tone="success"
        text={`Contestação aceita por ${contest.decidedBy?.name ?? 'supervisor'}: a foto passou a valer como aprovada.${contest.response ? `\n${contest.response}` : ''}`}
      />
    )
  }
  return <Banner tone="danger" text={`Contestação negada por ${contest.decidedBy?.name ?? 'supervisor'}: ${contest.response ?? ''}\nSua explicação: "${contest.reason}"`} />
}

function ContestPanel({
  photo,
  remaining,
  onContested,
}: {
  photo: RejectedPhoto
  remaining: number
  onContested: (res: { item: RejectedPhoto; remainingToday: number }) => void
}) {
  const [writing, setWriting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escrevendo a explicação, a caixa vai para o alto do visualizador e o teclado abre abaixo dela
  useViewerTyping(writing)

  async function submit() {
    Keyboard.dismiss()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ item: RejectedPhoto; remainingToday: number }>(`/promotor/photos/${photo.id}/contest`, { body: { reason: reason.trim() } })
      setWriting(false)
      onContested(res)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const stop = () => {
    Keyboard.dismiss()
    setWriting(false)
  }

  const form = (
    <>
      <Field
        label="Por que a foto está certa?"
        value={reason}
        onChangeText={setReason}
        multiline
        autoFocus
        placeholder="Ex.: a gôndola estava completa; a luz da loja deixou a foto escura"
        hint={`Mínimo de ${MIN_REASON} caracteres. O supervisor lê antes de decidir.`}
        style={{ minHeight: 80 }}
      />
      <Row>
        <Button title="Voltar" variant="secondary" onPress={stop} style={{ flex: 1 }} />
        <Button title="Enviar contestação" onPress={submit} loading={busy} disabled={reason.trim().length < MIN_REASON} style={{ flex: 1 }} />
      </Row>
      {error ? <Banner tone="danger" text={error} /> : null}
    </>
  )

  return (
    <>
      {writing ? form : null}
      <Text style={styles.sectionTitle}>{photo.client.name}</Text>
      <Muted>
        {photoTypeLabels[photo.type]} · {formatDate(photo.visit.date)} às {formatTime(photo.takenAt)}
      </Muted>
      {photo.rejections.map((r) => (
        <Card key={r.id} style={{ padding: space.md }}>
          <Row>
            <Text style={[styles.text, { fontWeight: '700' }]}>
              Reprovada por {r.auditor.name} ({roleLabels[r.auditor.role]})
            </Text>
          </Row>
          {r.justification ? <Text style={styles.text}>"{r.justification}"</Text> : null}
          <Muted>{formatDateTime(r.at)}</Muted>
        </Card>
      ))}
      {photo.contest ? <ContestResult contest={photo.contest} /> : null}
      {!writing && photo.canContest ? (
        remaining > 0 ? (
          <Button title="Contestar esta foto" variant="secondary" onPress={() => setWriting(true)} />
        ) : (
          <Banner tone="info" text="Você já usou as contestações de hoje. Amanhã pode contestar esta foto, se ela ainda estiver nos últimos 14 dias." />
        )
      ) : null}
      {!writing && error ? <Banner tone="danger" text={error} /> : null}
    </>
  )
}
