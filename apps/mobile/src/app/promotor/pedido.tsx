import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Text } from 'react-native'
import { Banner, Button, Card, Field, Muted, Screen, SectionTitle, styles } from '@/components/ui'
import { ClientSearch } from '@/features/ClientSearch'
import { permissionLabels, useDay } from '@/features/promotor/DayContext'
import { api, errorMessage } from '@/lib/api'
import { getQuickLocation } from '@/lib/location'
import type { Client } from '@/lib/types'

const descriptions: Record<string, string> = {
  CHECKIN_FORA_CERCA: 'O supervisor libera o check-in neste cliente mesmo fora do raio da cerca eletrônica.',
  DISPENSA_FOTOS: 'O supervisor libera a finalização do atendimento sem as fotos obrigatórias.',
  SUBSTITUIR_CLIENTE: 'O supervisor troca este cliente do roteiro por outro.',
}

/** Pedido de liberação para uma visita (cerca, fotos ou troca de cliente). */
export default function PedidoLiberacao() {
  const { type, visitId } = useLocalSearchParams<{ type: string; visitId?: string }>()
  const router = useRouter()
  const { day, reload } = useDay()
  const [reason, setReason] = useState('')
  const [replacement, setReplacement] = useState<Client | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visit = day?.visits.find((v) => v.id === visitId)
  const needsClient = type === 'SUBSTITUIR_CLIENTE'
  const ok = reason.trim().length >= 3 && (!needsClient || !!replacement)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const loc = await getQuickLocation()
      await api('/promotor/requests', {
        body: {
          type,
          visitId,
          payload: needsClient ? { clientId: replacement!.id } : undefined,
          reason: reason.trim(),
          latitude: loc?.latitude,
          longitude: loc?.longitude,
        },
      })
      await reload()
      Alert.alert('Pedido enviado', 'Você será avisado aqui quando o supervisor responder.', [{ text: 'OK', onPress: () => router.back() }])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.sectionTitle}>{permissionLabels[type] ?? type}</Text>
        {descriptions[type] ? <Muted>{descriptions[type]}</Muted> : null}
        {visit ? (
          <Text style={styles.text}>
            Cliente: <Text style={{ fontWeight: '700' }}>{visit.client.name}</Text>
          </Text>
        ) : null}
      </Card>

      {needsClient ? (
        <>
          <SectionTitle>Cliente substituto</SectionTitle>
          {replacement ? <Banner tone="success" text={`Selecionado: ${replacement.name}`} /> : null}
          <ClientSearch
            fetcher={(search) => api<Client[]>(`/promotor/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`)}
            onSelect={setReplacement}
            selectedId={replacement?.id}
          />
        </>
      ) : null}

      <Field label="Motivo do pedido" value={reason} onChangeText={setReason} multiline placeholder="Explique ao supervisor por que precisa desta liberação" />
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button title="Enviar pedido ao supervisor" onPress={submit} loading={busy} disabled={!ok} />
    </Screen>
  )
}
