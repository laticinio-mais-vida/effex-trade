import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert } from 'react-native'
import { Banner, Button, EmptyState, Field, Muted, Screen } from '@/components/ui'
import { useDay } from '@/features/promotor/DayContext'
import { ReorderList } from '@/features/ReorderList'
import { api, errorMessage } from '@/lib/api'
import { getQuickLocation } from '@/lib/location'

/** Pedido de alteração da ordem dos clientes pendentes (ex.: antecipar um cliente). */
export default function AlterarOrdem() {
  const { first } = useLocalSearchParams<{ first?: string }>()
  const router = useRouter()
  const { day, reload } = useDay()
  const pending = useMemo(() => day?.visits.filter((v) => v.status === 'PENDENTE') ?? [], [day])
  const original = pending.map((v) => v.id)
  const [order, setOrder] = useState<string[]>(() => (first && original.includes(first) ? [first, ...original.filter((id) => id !== first)] : original))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (pending.length < 2) return <EmptyState title="Nada para reordenar" text="É preciso ter ao menos dois clientes pendentes." />

  const changed = order.some((id, i) => id !== original[i])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const loc = await getQuickLocation()
      await api('/promotor/requests', {
        body: { type: 'ALTERAR_ORDEM', payload: { order }, reason: reason.trim(), latitude: loc?.latitude, longitude: loc?.longitude },
      })
      await reload()
      Alert.alert('Pedido enviado', 'Quando o supervisor aprovar, a nova ordem vale no seu roteiro.', [{ text: 'OK', onPress: () => router.back() }])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Muted>Use as setas para propor a nova sequência dos clientes ainda não atendidos. A mudança só vale depois da aprovação do supervisor.</Muted>
      <ReorderList
        items={pending.map((v) => ({ id: v.id, title: v.client.name, subtitle: v.client.address }))}
        order={order}
        original={original}
        onChange={setOrder}
      />
      <Field label="Motivo" value={reason} onChangeText={setReason} multiline placeholder="Ex.: cliente só recebe até as 10h" />
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button title="Enviar pedido ao supervisor" onPress={submit} loading={busy} disabled={!changed || reason.trim().length < 3} />
    </Screen>
  )
}
