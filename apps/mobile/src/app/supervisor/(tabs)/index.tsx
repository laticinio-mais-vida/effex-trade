import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import { Button, EmptyState, ErrorView, LoadingView, Muted, PromptSheet, Row, Screen, SectionTitle } from '@/components/ui'
import { RequestCard } from '@/features/RequestCard'
import { AlertCard, fetchOpenAlerts, notifyNewAlerts, useMinuteTick } from '@/features/supervisor/alerts'
import { api, errorMessage } from '@/lib/api'
import { emitBadgesChanged } from '@/lib/events'
import type { PermissionRequest, SupervisorAlert } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

/** Alertas da equipe (almoço acima do limite) e caixa de pedidos de liberação dos promotores (hoje). */
export default function Liberacoes() {
  const query = useQuery(() => api<PermissionRequest[]>('/supervisor/requests'))
  const alertsQuery = useQuery(async () => {
    const alerts = await fetchOpenAlerts()
    notifyNewAlerts(alerts)
    return alerts
  })
  const [deciding, setDeciding] = useState<{ request: PermissionRequest; approve: boolean } | null>(null)
  const reload = query.reload
  const reloadAlerts = alertsQuery.reload
  useMinuteTick()

  // Atualiza ao abrir a aba e a cada 30 s enquanto ela estiver visível
  useFocusEffect(
    useCallback(() => {
      void reload()
      void reloadAlerts()
      const timer = setInterval(() => {
        void reload()
        void reloadAlerts()
      }, 30_000)
      return () => clearInterval(timer)
    }, [reload, reloadAlerts]),
  )

  const alerts: SupervisorAlert[] = alertsQuery.data ?? []
  const refreshAll = () => {
    void alertsQuery.refresh()
    return query.refresh()
  }

  if (query.loading && !query.data) return <LoadingView />
  if (query.error && !query.data) return <ErrorView message={query.error} onRetry={query.refresh} />

  const all = query.data ?? []
  const pending = all.filter((r) => r.status === 'PENDENTE')
  const decided = all.filter((r) => r.status !== 'PENDENTE')

  async function decide(request: PermissionRequest, approve: boolean, note: string) {
    try {
      await api(`/supervisor/requests/${request.id}/decide`, { body: { approve, note: note || undefined } })
      setDeciding(null)
      emitBadgesChanged()
      await reload()
    } catch (e) {
      setDeciding(null)
      Alert.alert('Não foi possível decidir', errorMessage(e))
      await reload()
    }
  }

  return (
    <Screen refreshing={query.refreshing} onRefresh={refreshAll}>
      {alerts.length > 0 ? (
        <>
          <SectionTitle>Alertas ({alerts.length})</SectionTitle>
          {alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onAcknowledged={() => {
                alertsQuery.setData((list) => (list ?? []).filter((x) => x.id !== a.id))
                emitBadgesChanged()
                void reloadAlerts()
              }}
            />
          ))}
        </>
      ) : null}

      <SectionTitle>Aguardando você ({pending.length})</SectionTitle>
      {pending.length === 0 ? <EmptyState title="Nenhum pedido pendente" text="Os pedidos dos promotores aparecem aqui assim que forem enviados." /> : null}
      {pending.map((r) => (
        <RequestCard
          key={r.id}
          request={r}
          showPromotor
          actions={
            <Row>
              <Button title="Negar" variant="secondary" small onPress={() => setDeciding({ request: r, approve: false })} style={{ flex: 1 }} />
              <Button title="Aprovar" variant="success" small onPress={() => setDeciding({ request: r, approve: true })} style={{ flex: 1 }} />
            </Row>
          }
        />
      ))}

      {decided.length > 0 ? (
        <>
          <SectionTitle>Decididos hoje</SectionTitle>
          <Muted>Inclui liberações diretas feitas por você.</Muted>
          {decided.map((r) => (
            <RequestCard key={r.id} request={r} showPromotor />
          ))}
        </>
      ) : null}

      <PromptSheet
        visible={!!deciding}
        title={deciding?.approve ? 'Aprovar liberação' : 'Negar liberação'}
        message={deciding ? `${deciding.request.typeLabel} - ${deciding.request.promotor.name}` : undefined}
        placeholder={deciding?.approve ? 'Observação para o promotor (opcional)' : 'Explique ao promotor o motivo'}
        minLength={deciding?.approve ? 0 : 3}
        confirmLabel={deciding?.approve ? 'Aprovar' : 'Negar'}
        confirmVariant={deciding?.approve ? 'success' : 'danger'}
        onClose={() => setDeciding(null)}
        onConfirm={(note) => (deciding ? decide(deciding.request, deciding.approve, note) : undefined)}
      />
    </Screen>
  )
}
