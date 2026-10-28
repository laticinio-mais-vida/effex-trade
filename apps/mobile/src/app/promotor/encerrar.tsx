import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, Switch, Text, View } from 'react-native'
import { Banner, Button, Card, Field, LoadingView, Muted, Row, Screen, styles } from '@/components/ui'
import { dayClosed, useDay } from '@/features/promotor/DayContext'
import { api, ApiError, errorMessage } from '@/lib/api'
import { getQuickLocation } from '@/lib/location'
import { colors, space } from '@/lib/theme'
import { stopTracking } from '@/lib/tracking'

type Entry = { reasonId: string | null; text: string }

function ReasonOptions({ reasons, value, onChange }: { reasons: { id: string; label: string }[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {reasons.map((r) => (
        <Pressable key={r.id} onPress={() => onChange(r.id)} style={[styles.option, { paddingVertical: 8 }, value === r.id && styles.optionActive]}>
          <Text style={[styles.text, { fontWeight: '600' }, value === r.id && { color: colors.primary }]}>{r.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/**
 * Encerrar o roteiro do dia. Com a regra de roteiro completo, os clientes sem atendimento
 * precisam ser justificados um a um (ou com o mesmo motivo para todos) na mesma ação.
 */
export default function EncerrarRoteiro() {
  const router = useRouter()
  const { day, reload } = useDay()
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [same, setSame] = useState(false)
  const [shared, setShared] = useState<Entry>({ reasonId: null, text: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const pending = useMemo(() => day?.visits.filter((v) => v.status === 'PENDENTE') ?? [], [day])
  const inProgress = day?.visits.find((v) => v.status === 'EM_ATENDIMENTO')

  useEffect(() => {
    setEntries((prev) => Object.fromEntries(pending.map((v) => [v.id, prev[v.id] ?? { reasonId: null, text: '' }])))
  }, [pending])

  if (!day) return <LoadingView />
  const rules = day.rules
  const min = rules.justificationMinLength
  const required = rules.requireCompleteRouteToEnd

  const entryOf = (visitId: string): Entry => (same ? shared : (entries[visitId] ?? { reasonId: null, text: '' }))
  const isFilled = (e: Entry) => !!e.reasonId && e.text.trim().length >= min
  const isStarted = (e: Entry) => !!e.reasonId || e.text.trim().length > 0
  const toSend = pending.filter((v) => (required ? true : isStarted(entryOf(v.id))))
  const ready = toSend.every((v) => isFilled(entryOf(v.id)))

  async function submit() {
    setBusy(true)
    setErrors({})
    try {
      const loc = await getQuickLocation()
      await api('/promotor/day/end', {
        body: {
          latitude: loc?.latitude,
          longitude: loc?.longitude,
          justifications: toSend.map((v) => ({ visitId: v.id, reasonId: entryOf(v.id).reasonId!, text: entryOf(v.id).text.trim() })),
        },
      })
      await stopTracking()
      await reload()
      Alert.alert('Roteiro encerrado', 'Bom descanso!', [{ text: 'OK', onPress: () => router.back() }])
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'JUSTIFICATIVA_CURTA' && e.details?.visitId) {
          setErrors({ [e.details.visitId]: e.message })
          if (same) Alert.alert('Justificativa curta', e.message)
        } else if (e.code === 'ROTEIRO_INCOMPLETO' || e.code === 'ROTEIRO_MUDOU') {
          await reload()
          Alert.alert('O roteiro mudou', e.message)
        } else if (e.code === 'ATENDIMENTO_EM_ANDAMENTO') {
          Alert.alert('Atendimento em andamento', e.message)
        } else {
          Alert.alert('Não foi possível encerrar', e.message)
        }
      } else {
        Alert.alert('Não foi possível encerrar', errorMessage(e))
      }
    } finally {
      setBusy(false)
    }
  }

  if (dayClosed(day)) {
    return (
      <Screen>
        <Banner tone="success" text="O roteiro de hoje já está encerrado." />
      </Screen>
    )
  }

  return (
    <Screen
      footer={
        <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Button title={pending.length > 0 ? 'Justificar e encerrar roteiro' : 'Encerrar roteiro'} onPress={submit} loading={busy} disabled={!!inProgress || !ready} />
        </View>
      }
    >
      {inProgress ? (
        <Card style={{ borderColor: colors.info, backgroundColor: colors.infoSoft }}>
          <Text style={[styles.text, { fontWeight: '700' }]}>Atendimento em andamento em {inProgress.client.name}</Text>
          <Muted>Faça o check-out desse cliente antes de encerrar o roteiro.</Muted>
          <Button title="Ir para o atendimento" small onPress={() => router.replace(`/promotor/visita/${inProgress.id}`)} />
        </Card>
      ) : null}

      {pending.length === 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>Tudo certo</Text>
          <Muted>Todos os clientes do dia foram atendidos ou justificados. Ao encerrar, o envio da sua localização é interrompido.</Muted>
        </Card>
      ) : (
        <>
          <Banner
            tone="warning"
            text={
              required
                ? `Ainda há ${pending.length} cliente(s) sem atendimento. Para encerrar o roteiro agora, justifique cada um.`
                : `Ainda há ${pending.length} cliente(s) sem atendimento. Os que não forem justificados ficam como "não feito".`
            }
          />
          {pending.length > 1 ? (
            <Card>
              <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <Text style={[styles.text, { fontWeight: '700', flex: 1 }]}>Usar o mesmo motivo e texto para todos</Text>
                <Switch value={same} onValueChange={setSame} trackColor={{ true: colors.primary }} />
              </Row>
            </Card>
          ) : null}

          {same ? (
            <Card>
              <Text style={styles.label}>Motivo para os {pending.length} clientes</Text>
              <ReasonOptions reasons={day.reasons} value={shared.reasonId} onChange={(reasonId) => setShared({ ...shared, reasonId })} />
              <Field
                label="O que aconteceu"
                value={shared.text}
                onChangeText={(text) => setShared({ ...shared, text })}
                multiline
                hint={`${shared.text.trim().length}/${min} caracteres no mínimo`}
              />
              <Muted>Clientes: {pending.map((v) => v.client.name).join(', ')}</Muted>
            </Card>
          ) : (
            pending.map((v) => {
              const entry = entries[v.id] ?? { reasonId: null, text: '' }
              const set = (patch: Partial<Entry>) => setEntries((prev) => ({ ...prev, [v.id]: { ...entry, ...patch } }))
              return (
                <Card key={v.id} style={errors[v.id] ? { borderColor: colors.danger } : undefined}>
                  <Text style={[styles.text, { fontWeight: '700' }]}>
                    {v.position}. {v.client.name}
                  </Text>
                  <ReasonOptions reasons={day.reasons} value={entry.reasonId} onChange={(reasonId) => set({ reasonId })} />
                  <Field
                    value={entry.text}
                    onChangeText={(text) => set({ text })}
                    multiline
                    placeholder="Explique por que não atendeu"
                    error={errors[v.id] ?? null}
                    hint={`${entry.text.trim().length}/${min} caracteres no mínimo`}
                  />
                </Card>
              )
            })
          )}
        </>
      )}
    </Screen>
  )
}
