import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import { Button, EmptyState, ErrorView, LoadingView, Muted, Screen } from '@/components/ui'
import { useDay } from '@/features/promotor/DayContext'
import { RequestCard } from '@/features/RequestCard'
import { api, errorMessage } from '@/lib/api'

export default function MinhasLiberacoes() {
  const { requests, loading, error, refreshing, refresh, reload } = useDay()
  const [cancelling, setCancelling] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  if (loading && requests.length === 0) return <LoadingView />
  if (error && requests.length === 0) return <ErrorView message={error} onRetry={refresh} />

  async function cancel(id: string) {
    setCancelling(id)
    try {
      await api(`/promotor/requests/${id}/cancel`, { method: 'POST' })
      await reload()
    } catch (e) {
      Alert.alert('Não foi possível cancelar', errorMessage(e))
    } finally {
      setCancelling(null)
    }
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Muted>Pedidos de hoje ao supervisor. A tela atualiza sozinha enquanto houver pedido aguardando.</Muted>
      {requests.length === 0 ? (
        <EmptyState title="Nenhum pedido hoje" text="Peça liberação pela tela do atendimento quando precisar (cerca, fotos, ordem ou troca de cliente)." />
      ) : null}
      {requests.map((r) => (
        <RequestCard
          key={r.id}
          request={r}
          actions={
            r.status === 'PENDENTE' ? (
              <Button title="Cancelar pedido" variant="ghost" small loading={cancelling === r.id} onPress={() => cancel(r.id)} />
            ) : null
          }
        />
      ))}
    </Screen>
  )
}
