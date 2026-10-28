import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback } from 'react'
import { Text, View } from 'react-native'
import { Badge, Card, EmptyState, ErrorView, LoadingView, Muted, Row, Screen, SectionTitle, styles } from '@/components/ui'
import { api } from '@/lib/api'
import { colors, radius } from '@/lib/theme'
import type { SupervisorAlert, Team } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

export default function Equipe() {
  const router = useRouter()
  const query = useQuery(async () => {
    const [team, alerts] = await Promise.all([api<Team>('/supervisor/team'), api<SupervisorAlert[]>('/supervisor/alerts?state=todos').catch(() => [] as SupervisorAlert[])])
    return { team, alerts }
  })
  const reload = query.reload
  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  if (query.loading && !query.data) return <LoadingView />
  if (query.error && !query.data) return <ErrorView message={query.error} onRetry={query.refresh} />
  const { team, alerts } = query.data!
  // Promotor com alerta ainda sem "ciente" ou ainda em almoço acima do limite
  const alerted = new Set(alerts.filter((a) => !a.acknowledgedAt || !a.resolvedAt).map((a) => a.promotor.id))

  return (
    <Screen refreshing={query.refreshing} onRefresh={query.refresh}>
      <SectionTitle>Promotores · hoje</SectionTitle>
      {team.promotores.length === 0 ? <EmptyState title="Nenhum promotor na sua equipe" /> : null}
      {team.promotores.map((p) => {
        const t = p.today
        const finished = t.done + t.justified
        return (
          <Card
            key={p.id}
            onPress={() => router.push(`/supervisor/promotor/${p.id}`)}
            style={alerted.has(p.id) ? { borderColor: colors.danger, backgroundColor: colors.dangerSoft } : undefined}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[styles.text, { fontWeight: '700', color: alerted.has(p.id) ? colors.danger : colors.text }]}>{p.name}</Text>
              {alerted.has(p.id) ? (
                <Badge label="Almoço acima do limite" color={colors.danger} bg={colors.surface} />
              ) : t.inProgress > 0 ? (
                <Badge label="Em atendimento" color={colors.info} bg={colors.infoSoft} />
              ) : null}
            </Row>
            <Muted>
              {finished}/{t.total} finalizados · {t.done} feitos · {t.justified} justificados · {t.pending} não feitos
            </Muted>
            <View style={{ height: 6, backgroundColor: colors.neutralSoft, borderRadius: radius.sm, overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ flex: t.done, backgroundColor: colors.success }} />
              <View style={{ flex: t.justified, backgroundColor: colors.warning }} />
              <View style={{ flex: t.inProgress, backgroundColor: colors.info }} />
              <View style={{ flex: t.pending }} />
            </View>
          </Card>
        )
      })}

      <SectionTitle>Vendedores</SectionTitle>
      {team.vendedores.map((v) => (
        <Card key={v.id} onPress={() => router.push('/supervisor/vendedores')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[styles.text, { fontWeight: '700' }]}>{v.name}</Text>
            {v.pendingReviews > 0 ? (
              <Badge label={`${v.pendingReviews} auditoria(s) a conferir`} color={colors.warning} bg={colors.warningSoft} />
            ) : (
              <Badge label="Tudo conferido" color={colors.success} bg={colors.successSoft} />
            )}
          </Row>
        </Card>
      ))}
    </Screen>
  )
}
