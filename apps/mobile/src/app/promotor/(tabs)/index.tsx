import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Banner, Button, Card, EmptyState, ErrorView, LoadingView, Muted, Row, Screen, SectionTitle, styles } from '@/components/ui'
import { dayClosed, onLunch, permissionLabels, useDay } from '@/features/promotor/DayContext'
import { VisitCard } from '@/features/VisitCard'
import { api, ApiError, errorMessage } from '@/lib/api'
import { formatLongDate, formatTime } from '@/lib/format'
import { getQuickLocation } from '@/lib/location'
import { colors, radius, space } from '@/lib/theme'

/** "2h", "1h30" ou "45 min" */
function formatLimit(min: number) {
  if (min < 60) return `${min} min`
  return min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

const trackingText = {
  background: 'Localização enviada ao supervisor, mesmo com o app fechado.',
  foreground: 'Localização enviada ao supervisor enquanto o app estiver aberto.',
  off: 'Envio de localização desligado.',
}

export default function MeuDia() {
  const router = useRouter()
  const { day, requests, loading, error, refreshing, refresh, reload, tracking } = useDay()
  const [startingLunch, setStartingLunch] = useState(false)

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  if (loading && !day) return <LoadingView text="Carregando seu roteiro..." />
  if (error && !day) return <ErrorView message={error} onRetry={refresh} />
  if (!day) return null

  const visits = day.visits
  const done = visits.filter((v) => v.status === 'CONCLUIDA').length
  const justified = visits.filter((v) => v.status === 'JUSTIFICADA').length
  const pending = visits.filter((v) => v.status === 'PENDENTE')
  const finished = done + justified
  const inProgress = visits.find((v) => v.id === day.inProgressVisitId)
  const wd = day.workDay
  const started = !!wd?.startedAt
  const ended = dayClosed(day)
  const lunch = onLunch(day)
  const canAct = day.isToday && !ended
  const canStartLunch = canAct && day.rules.lunchBreakEnabled && started && !wd?.lunchStartedAt
  const lunchAlert = day.rules.lunchAlertMinutes ?? 0
  const lunchAlertText = lunchAlert > 0 ? `Se o almoço passar de ${formatLimit(lunchAlert)}, seu supervisor é avisado.` : null
  const dayOrderRequest = requests.find((r) => r.type === 'LIVRE_ORDEM_DIA' && r.status === 'PENDENTE')

  function startLunch() {
    Alert.alert('Iniciar almoço?', ['Durante o almoço nenhuma atividade pode ser feita. A volta do almoço é a abertura do próximo cliente.', lunchAlertText].filter(Boolean).join(' '), [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Iniciar almoço',
        onPress: async () => {
          setStartingLunch(true)
          try {
            const loc = await getQuickLocation()
            await api('/promotor/lunch/start', { body: loc ? { latitude: loc.latitude, longitude: loc.longitude } : {} })
            await reload()
          } catch (e) {
            if (e instanceof ApiError && ['ROTEIRO_NAO_INICIADO', 'ALMOCO_JA_FEITO', 'ATENDIMENTO_EM_ANDAMENTO', 'ALMOCO_DESATIVADO', 'EM_ALMOCO', 'ROTEIRO_ENCERRADO'].includes(e.code ?? '')) {
              void reload()
            }
            Alert.alert('Almoço não iniciado', errorMessage(e))
          } finally {
            setStartingLunch(false)
          }
        },
      },
    ])
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {lunch && canAct ? (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
          <Text style={[styles.text, { fontWeight: '700', color: colors.warning }]}>Em almoço desde {formatTime(wd?.lunchStartedAt)}.</Text>
          <Text style={styles.text}>A volta do almoço é a abertura do próximo cliente. Até lá, nenhuma atividade pode ser feita.</Text>
          {lunchAlertText ? <Text style={styles.text}>{lunchAlertText}</Text> : null}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.title}>{formatLongDate(day.date)}</Text>
        <Muted>
          {finished} de {visits.length} clientes finalizados · {done} feitos · {justified} justificados
        </Muted>
        <View style={{ height: 8, backgroundColor: colors.neutralSoft, borderRadius: radius.sm, overflow: 'hidden', flexDirection: 'row' }}>
          <View style={{ flex: done, backgroundColor: colors.success }} />
          <View style={{ flex: justified, backgroundColor: colors.warning }} />
          <View style={{ flex: Math.max(visits.length - finished, 0) }} />
        </View>

        <View style={{ gap: 2 }}>
          {started ? (
            <Text style={styles.text}>
              Início do trabalho: <Text style={{ fontWeight: '700' }}>{formatTime(wd?.startedAt)}</Text> <Muted>(abertura do primeiro atendimento)</Muted>
            </Text>
          ) : day.isToday && !ended ? (
            <Muted>O roteiro e o horário de início do trabalho começam quando você abrir o primeiro atendimento.</Muted>
          ) : null}
          {wd?.lunchStartedAt && wd.lunchEndedAt ? (
            <Text style={styles.text}>
              Almoço: {formatTime(wd.lunchStartedAt)}–{formatTime(wd.lunchEndedAt)}
            </Text>
          ) : null}
          {ended ? (
            <>
              <Text style={styles.text}>
                Fim do trabalho: <Text style={{ fontWeight: '700' }}>{formatTime(wd?.endedAt)}</Text> <Muted>(última atividade)</Muted>
              </Text>
              <Muted>Roteiro encerrado às {formatTime(wd?.closedAt ?? wd?.endedAt)}.</Muted>
            </>
          ) : null}
        </View>

        {ended ? (
          <Banner tone="success" text="Roteiro de hoje encerrado." />
        ) : !day.isToday ? null : (
          <View style={{ gap: space.sm }}>
            {started ? <Muted>{trackingText[tracking.mode]}</Muted> : null}
            {tracking.reason && started ? <Banner tone="warning" text={tracking.reason} /> : null}
            {visits.length > 0 ? (
              <Button
                title={pending.length === 0 && !inProgress ? 'Encerrar roteiro' : 'Encerrar roteiro antes de concluir'}
                variant={pending.length === 0 && !inProgress && !lunch ? 'primary' : 'secondary'}
                onPress={() => router.push('/promotor/encerrar')}
                small
              />
            ) : null}
          </View>
        )}
      </Card>

      {inProgress ? (
        <Card onPress={() => router.push(`/promotor/visita/${inProgress.id}`)} style={{ backgroundColor: colors.infoSoft, borderColor: colors.info }}>
          <Text style={[styles.text, { fontWeight: '700', color: colors.info }]}>Em atendimento desde {formatTime(inProgress.checkinAt)}</Text>
          <Text style={styles.sectionTitle}>{inProgress.client.name}</Text>
          <Muted>Toque para continuar o atendimento</Muted>
        </Card>
      ) : null}

      <SectionTitle right={canAct && !lunch && pending.length >= 2 ? <Button title="Alterar ordem" variant="ghost" small onPress={() => router.push('/promotor/ordem')} /> : null}>
        Clientes do dia
      </SectionTitle>
      {canAct && lunch ? <Muted>Toque no próximo cliente para abrir o atendimento (volta do almoço) ou justificá-lo.</Muted> : null}
      {canAct && !lunch && day.rules.enforceRouteOrder && pending.length > 0 ? (
        <>
          <Muted>Siga a ordem do roteiro. Clientes extras podem ser atendidos a qualquer momento.</Muted>
          {dayOrderRequest ? (
            <Banner tone="warning" text={`Aguardando supervisor: ${permissionLabels.LIVRE_ORDEM_DIA}`} />
          ) : pending.length >= 2 ? (
            <Row>
              <Button
                title="Pedir para não seguir a ordem hoje"
                variant="ghost"
                small
                onPress={() => router.push({ pathname: '/promotor/pedido', params: { type: 'LIVRE_ORDEM_DIA' } })}
              />
            </Row>
          ) : null}
        </>
      ) : null}
      {canAct && wd?.routeOrderWaived ? <Banner tone="success" text="O supervisor liberou a ordem do roteiro hoje: atenda os clientes na sequência que preferir." /> : null}

      {visits.length === 0 ? <EmptyState title="Nenhum cliente no roteiro de hoje" text={canAct ? 'Você pode incluir um cliente extra abaixo.' : undefined} /> : null}
      {visits.map((v) => (
        <VisitCard key={v.id} visit={v} isNext={canAct && v.id === day.nextVisitId} onPress={() => router.push(`/promotor/visita/${v.id}`)} />
      ))}

      {day.rules.allowExtraVisits && canAct && !lunch ? (
        <Row style={{ marginTop: space.sm }}>
          <Button title="+ Incluir cliente extra" variant="secondary" onPress={() => router.push('/promotor/adicionar')} style={{ flex: 1 }} />
        </Row>
      ) : null}

      {canStartLunch ? (
        <View style={{ gap: space.xs }}>
          <Row>
            <Button title="Iniciar almoço" variant="secondary" onPress={startLunch} loading={startingLunch} disabled={!!inProgress} style={{ flex: 1 }} />
          </Row>
          {inProgress ? <Muted>Encerre o atendimento antes de sair para o almoço.</Muted> : null}
        </View>
      ) : null}
    </Screen>
  )
}
