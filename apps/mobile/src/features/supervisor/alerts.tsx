import { useEffect, useState } from 'react'
import { Alert, Linking, Text, Vibration } from 'react-native'
import { Badge, Button, Card, Muted, Row, styles } from '@/components/ui'
import { api } from '@/lib/api'
import { formatMinutes, formatTime, minutesSince } from '@/lib/format'
import { borders, colors, type } from '@/lib/theme'
import type { SupervisorAlert } from '@/lib/types'

/** Alertas já avisados nesta sessão do app (não repete o aviso do mesmo alerta). */
const seen = new Set<string>()

export function fetchOpenAlerts() {
  return api<SupervisorAlert[]>('/supervisor/alerts')
}

/** Avisa (diálogo + vibração) os alertas abertos ainda não vistos nesta sessão. */
export function notifyNewAlerts(alerts: SupervisorAlert[]) {
  const fresh = alerts.filter((a) => !a.acknowledgedAt && !seen.has(a.id))
  if (fresh.length === 0) return
  fresh.forEach((a) => seen.add(a.id))
  Vibration.vibrate([0, 400, 200, 400])
  Alert.alert(fresh.length === 1 ? 'Almoço acima do limite' : `${fresh.length} alertas de almoço acima do limite`, fresh.map((a) => a.message).join('\n\n'))
}

/** Relógio que muda a cada minuto (duração ao vivo do almoço). */
export function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
}

export function AlertCard({ alert, onAcknowledged }: { alert: SupervisorAlert; onAcknowledged: () => void }) {
  const [busy, setBusy] = useState(false)
  const ongoing = !alert.resolvedAt && !alert.lunchEndedAt

  async function acknowledge() {
    setBusy(true)
    try {
      await api(`/supervisor/alerts/${alert.id}/ack`, { body: {} })
      onAcknowledged()
    } catch (e) {
      Alert.alert('Não foi possível marcar ciente', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={ongoing ? { borderColor: colors.naoFeito, borderWidth: borders.campo } : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[styles.sectionTitle, { flex: 1 }]}>{alert.promotor.name}</Text>
        <Badge label="Almoço acima do limite" tone="naoFeito" />
      </Row>
      <Text style={styles.text}>{alert.message}</Text>
      {ongoing && alert.lunchStartedAt ? (
        <Text style={[type.textoForte, { color: colors.naoFeito }]}>
          Em almoço há {formatMinutes(minutesSince(alert.lunchStartedAt))} (desde {formatTime(alert.lunchStartedAt)})
        </Text>
      ) : (
        <Muted>Voltou às {formatTime(alert.lunchEndedAt ?? alert.resolvedAt)}.</Muted>
      )}
      <Row>
        {alert.promotor.phone ? (
          <Button title="Ligar" variant="secondary" small onPress={() => void Linking.openURL(`tel:${alert.promotor.phone!.replace(/[^\d+]/g, '')}`)} style={{ flex: 1 }} />
        ) : null}
        <Button title="Ciente" small onPress={acknowledge} loading={busy} style={{ flex: 1 }} />
      </Row>
    </Card>
  )
}
