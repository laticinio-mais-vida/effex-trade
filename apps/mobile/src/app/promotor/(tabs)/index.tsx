import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Banner, Button, Card, EmptyState, ErrorView, LoadingView, Muted, ProgressBar, Screen, SectionTitle, styles, TextAction } from '@/components/ui'
import { dayClosed, onLunch, permissionLabels, useDay } from '@/features/promotor/DayContext'
import { VisitCard } from '@/features/VisitCard'
import { api, ApiError, errorMessage } from '@/lib/api'
import { formatLongDate, formatMinutes, formatTime, minutesSince, placeOf } from '@/lib/format'
import { getQuickLocation } from '@/lib/location'
import { colors, space, type } from '@/lib/theme'
import type { Visit } from '@/lib/types'
import { stepLine, stepTitles, visitSteps } from '@/lib/visitSteps'

/** "2h", "1h30" ou "45 min" */
function formatLimit(min: number) {
  if (min < 60) return `${min} min`
  return min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** Só aparece quando há problema no envio da localização. */
const trackingProblem = {
  foreground: 'Sua localização só vai para o supervisor com o app aberto.',
  off: 'O envio da sua localização está desligado.',
}

/**
 * Meu dia: (1) o que fazer agora, no cartão "Agora"; (2) o andamento numa faixa compacta; (3) a lista de clientes;
 * (4) as ações raras no fim.
 */
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
  const nextVisit = visits.find((v) => v.id === day.nextVisitId)
  const wd = day.workDay
  const started = !!wd?.startedAt
  const ended = dayClosed(day)
  const lunch = onLunch(day)
  const canAct = day.isToday && !ended
  const canStartLunch = canAct && day.rules.lunchBreakEnabled && started && !wd?.lunchStartedAt
  const lunchAlert = day.rules.lunchAlertMinutes ?? 0
  const lunchAlertText = lunchAlert > 0 ? `Se o almoço passar de ${formatLimit(lunchAlert)}, seu supervisor é avisado.` : null
  const dayOrderRequest = requests.find((r) => r.type === 'LIVRE_ORDEM_DIA' && r.status === 'PENDENTE')
  // O cliente que está no cartão "Agora" aparece compacto na lista, marcado "acima"
  const agora: Visit | undefined = canAct ? (inProgress ?? nextVisit) : undefined
  const openVisit = (v: Visit, open?: boolean) => router.push(open ? `/promotor/visita/${v.id}?abrir=1` : `/promotor/visita/${v.id}`)
  const trackingWarning = started && canAct ? (tracking.reason ?? (tracking.mode === 'background' ? null : trackingProblem[tracking.mode])) : null

  // Faixa compacta: "2 de 6 · início 08:06 · almoço 12:40–13:39"
  const strip = [
    `${finished} de ${visits.length}`,
    started ? `início ${formatTime(wd?.startedAt)}` : null,
    wd?.lunchStartedAt ? `almoço ${formatTime(wd.lunchStartedAt)}–${wd.lunchEndedAt ? formatTime(wd.lunchEndedAt) : 'agora'}` : null,
    ended ? `fim ${formatTime(wd?.endedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

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
      <View style={{ gap: space.xs }}>
        <Muted>{formatLongDate(day.date)}</Muted>
        <Text style={[type.textoForte, styles.number]}>{strip}</Text>
        <ProgressBar done={done} justified={justified} inProgress={inProgress ? 1 : 0} total={visits.length} />
        {wd?.reopenedAt && !ended ? <Muted>Roteiro reaberto às {formatTime(wd.reopenedAt)}. No fim, encerre de novo.</Muted> : null}
      </View>

      {trackingWarning ? <Banner tone="warning" text={trackingWarning} /> : null}

      <AgoraCard
        day={{ isToday: day.isToday, ended, lunch, started, allowExtra: day.rules.allowExtraVisits, closedAt: wd?.closedAt ?? wd?.endedAt ?? null, lunchStartedAt: wd?.lunchStartedAt ?? null }}
        rules={day.rules}
        inProgress={inProgress}
        next={nextVisit}
        lunchAlertText={lunchAlertText}
        pendingCount={pending.length}
        onOpen={openVisit}
        onFinish={() => router.push('/promotor/encerrar')}
        onReopenDay={() => router.push('/promotor/adicionar')}
      />

      <SectionTitle>Clientes do dia</SectionTitle>
      {canAct && !lunch && day.rules.enforceRouteOrder && pending.length > 0 && !wd?.routeOrderWaived ? (
        <Muted>Siga a ordem do roteiro. Clientes extras podem ser atendidos a qualquer momento.</Muted>
      ) : null}
      {canAct && dayOrderRequest ? <Banner tone="info" text={`Aguardando supervisor: ${permissionLabels.LIVRE_ORDEM_DIA}`} /> : null}
      {canAct && wd?.routeOrderWaived ? <Banner tone="success" text="O supervisor liberou a ordem do roteiro hoje: atenda os clientes na sequência que preferir." /> : null}

      {visits.length === 0 ? <EmptyState title="Nenhum cliente no roteiro de hoje" text={canAct ? 'Você pode incluir um cliente extra no fim da tela.' : undefined} /> : null}
      {visits.map((v) => (
        <VisitCard
          key={v.id}
          visit={v}
          compact={v.id === agora?.id}
          isNext={canAct && v.id === day.nextVisitId && v.id !== agora?.id}
          dayOpen={!ended && day.isToday}
          onPress={() => openVisit(v)}
        />
      ))}

      {canAct ? (
        <>
          <SectionTitle>Outras ações</SectionTitle>
          {canStartLunch ? (
            <Button
              title="Iniciar almoço"
              variant="secondary"
              onPress={startLunch}
              loading={startingLunch}
              disabled={!!inProgress}
              missing="Encerre o atendimento antes de sair para o almoço"
            />
          ) : null}
          {day.rules.allowExtraVisits && !lunch ? <Button title="+ Incluir cliente extra" variant="secondary" onPress={() => router.push('/promotor/adicionar')} /> : null}
          <View>
            {!lunch && pending.length >= 2 ? <TextAction title="Alterar ordem" onPress={() => router.push('/promotor/ordem')} /> : null}
            {!lunch && day.rules.enforceRouteOrder && pending.length >= 2 && !dayOrderRequest && !wd?.routeOrderWaived ? (
              <TextAction title="Pedir para não seguir a ordem hoje" onPress={() => router.push({ pathname: '/promotor/pedido', params: { type: 'LIVRE_ORDEM_DIA' } })} />
            ) : null}
            {visits.length > 0 && (pending.length > 0 || inProgress) ? (
              <TextAction title="Encerrar roteiro antes de concluir" onPress={() => router.push('/promotor/encerrar')} />
            ) : null}
          </View>
        </>
      ) : null}
    </Screen>
  )
}

type AgoraDay = { isToday: boolean; ended: boolean; lunch: boolean; started: boolean; allowExtra: boolean; closedAt: string | null; lunchStartedAt: string | null }

/** O que fazer agora: o atendimento aberto (e o próximo logo abaixo) ou o próximo cliente. */
function AgoraCard({
  day,
  rules,
  inProgress,
  next,
  lunchAlertText,
  pendingCount,
  onOpen,
  onFinish,
  onReopenDay,
}: {
  day: AgoraDay
  rules: Parameters<typeof visitSteps>[1]
  inProgress?: Visit
  next?: Visit
  lunchAlertText: string | null
  pendingCount: number
  onOpen: (v: Visit, open?: boolean) => void
  onFinish: () => void
  onReopenDay: () => void
}) {
  if (!day.isToday) return null

  if (day.ended) {
    return (
      <Card>
        <Text style={styles.sectionTitle}>Roteiro encerrado às {formatTime(day.closedAt)}</Text>
        {day.allowExtra ? (
          <>
            <Muted>Precisa atender mais um cliente hoje? Incluir um cliente reabre o roteiro: o envio de localização volta a ligar e, no fim, você encerra de novo.</Muted>
            <Button title="+ Incluir cliente e reabrir o roteiro" variant="secondary" onPress={onReopenDay} />
          </>
        ) : null}
      </Card>
    )
  }

  if (inProgress) {
    const info = visitSteps(inProgress, rules)
    return (
      <Card variant="emAtendimento">
        <Muted>Agora</Muted>
        <Text style={styles.sectionTitle}>{inProgress.client.name}</Text>
        <Text style={[styles.text, styles.number]}>
          Em atendimento há {formatMinutes(minutesSince(inProgress.checkinAt))} (desde {formatTime(inProgress.checkinAt)})
        </Text>
        <Text style={[type.textoForte, styles.number, { color: colors.marinho }]}>{stepLine(info)}</Text>
        <Muted>Próximo passo: {stepTitles[info.current]}</Muted>
        <Button title="Continuar atendimento" onPress={() => onOpen(inProgress)} />
        {next ? <Muted>Depois: {next.client.name}</Muted> : null}
      </Card>
    )
  }

  if (next) {
    const tasksOpen = next.tasks?.filter((t) => !t.done).length ?? 0
    const subtitle = [next.client.city ? placeOf(next.client) : null, tasksOpen > 0 ? `${tasksOpen} ${tasksOpen === 1 ? 'atividade' : 'atividades'}` : null].filter(Boolean).join(' · ')
    return (
      <Card variant="proximo">
        <Muted>{day.lunch ? `Em almoço desde ${formatTime(day.lunchStartedAt)}` : 'Agora'}</Muted>
        <Text style={styles.sectionTitle}>{next.client.name}</Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
        {day.lunch ? (
          <Muted>A volta do almoço é a abertura deste cliente.{lunchAlertText ? ` ${lunchAlertText}` : ''}</Muted>
        ) : !day.started ? (
          <Muted>O roteiro e o horário de início do trabalho começam quando você abrir este atendimento.</Muted>
        ) : null}
        <Button title={day.lunch ? 'Abrir atendimento (volta do almoço)' : 'Abrir atendimento'} onPress={() => onOpen(next, true)} />
      </Card>
    )
  }

  if (pendingCount === 0) {
    return (
      <Card variant="proximo">
        <Muted>Agora</Muted>
        <Text style={styles.sectionTitle}>Todos os clientes foram atendidos ou justificados</Text>
        <Button title="Encerrar roteiro" onPress={onFinish} />
      </Card>
    )
  }
  return null
}
