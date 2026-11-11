import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback } from 'react'
import { Text } from 'react-native'
import { Badge, Card, EmptyState, ErrorView, LoadingView, Muted, ProgressBar, Row, Screen, SectionTitle, styles } from '@/components/ui'
import { useMinuteTick } from '@/features/supervisor/alerts'
import { api } from '@/lib/api'
import { formatTime, isSignalStale, sinceLabel } from '@/lib/format'
import { colors, type } from '@/lib/theme'
import type { SupervisorAlert, Team } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

type TeamPromotor = Team['promotores'][number]

/** Onde o promotor está agora, numa linha. */
function whereNow(p: TeamPromotor) {
  if (p.lunch && !p.lunch.end) return `Em almoço desde ${formatTime(p.lunch.start)}`
  if (p.currentVisit) return `Em ${p.currentVisit.clientName}${p.currentVisit.since ? ` desde ${formatTime(p.currentVisit.since)}` : ''}`
  if (p.dayClosed) return 'Roteiro encerrado'
  if (!p.workStart) return 'Ainda não abriu o primeiro atendimento'
  return 'Em deslocamento'
}

/** Equipe do supervisor: exceções primeiro (sem sinal, almoço acima do limite); em cada promotor, onde está, andamento e último sinal. */
export default function Equipe() {
  const router = useRouter()
  const query = useQuery(async () => {
    const [team, alerts] = await Promise.all([api<Team>('/supervisor/team'), api<SupervisorAlert[]>('/supervisor/alerts?state=todos').catch(() => [] as SupervisorAlert[])])
    return { team, alerts }
  })
  const reload = query.reload
  useMinuteTick()
  useFocusEffect(
    useCallback(() => {
      void reload()
      const timer = setInterval(() => void reload(), 60_000)
      return () => clearInterval(timer)
    }, [reload]),
  )

  if (query.loading && !query.data) return <LoadingView />
  if (query.error && !query.data) return <ErrorView message={query.error} onRetry={query.refresh} />
  const { team, alerts } = query.data!
  // Promotor com alerta ainda sem "ciente" ou ainda em almoço acima do limite
  const alerted = new Set(alerts.filter((a) => !a.acknowledgedAt || !a.resolvedAt).map((a) => a.promotor.id))
  const noSignal = (p: TeamPromotor) => !p.dayClosed && isSignalStale(p.lastPingAt)
  const lunchOver = (p: TeamPromotor) => alerted.has(p.id) || (!!p.lunch && !p.lunch.end && p.lunch.overdue)
  const exception = (p: TeamPromotor) => noSignal(p) || lunchOver(p)
  const promotores = [...team.promotores].sort((a, b) => Number(exception(b)) - Number(exception(a)))

  return (
    <Screen refreshing={query.refreshing} onRefresh={query.refresh}>
      <SectionTitle>Promotores · hoje</SectionTitle>
      {promotores.length === 0 ? <EmptyState title="Nenhum promotor na sua equipe" /> : null}
      {promotores.map((p) => {
        const t = p.today
        const finished = t.done + t.justified
        const stale = noSignal(p)
        const late = lunchOver(p)
        return (
          <Card key={p.id} onPress={() => router.push(`/supervisor/promotor/${p.id}`)}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={[styles.sectionTitle, { flex: 1 }]}>{p.name}</Text>
              {late ? <Badge label="Almoço acima do limite" tone="naoFeito" /> : null}
              {stale ? <Badge label="Sem sinal" tone="naoFeito" /> : null}
              {!late && !stale && t.inProgress > 0 ? <Badge label="Em atendimento" tone="emAtendimento" /> : null}
            </Row>
            <Text style={late ? [type.textoForte, { color: colors.naoFeito }] : styles.text}>{whereNow(p)}</Text>
            <ProgressBar done={t.done} justified={t.justified} inProgress={t.inProgress} total={t.total} />
            <Muted>
              <Text style={styles.number}>
                {finished} de {t.total}
              </Text>{' '}
              · {t.done} feitos · {t.justified} justificados · {t.pending} não feitos
            </Muted>
            <Text style={stale ? [type.secundario, { color: colors.naoFeito }] : styles.muted}>
              {p.lastPingAt ? `Último sinal ${sinceLabel(p.lastPingAt)}` : 'Sem sinal hoje'}
            </Text>
          </Card>
        )
      })}

      <SectionTitle>Vendedores</SectionTitle>
      {team.vendedores.map((v) => (
        <Card key={v.id} onPress={() => router.push('/supervisor/fotos?secao=vendedores')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[styles.sectionTitle, { flex: 1 }]}>{v.name}</Text>
            {v.pendingReviews > 0 ? <Badge label={`${v.pendingReviews} a conferir`} tone="neutro" /> : <Badge label="Tudo conferido" tone="feito" />}
          </Row>
        </Card>
      ))}
    </Screen>
  )
}
