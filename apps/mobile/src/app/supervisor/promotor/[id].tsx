import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, Text } from 'react-native'
import { Banner, Button, Card, EmptyState, ErrorView, Field, LoadingView, Muted, Screen, SectionTitle, Sheet, styles } from '@/components/ui'
import { ClientSearch } from '@/features/ClientSearch'
import { ReorderList } from '@/features/ReorderList'
import { VisitCard } from '@/features/VisitCard'
import { api, errorMessage } from '@/lib/api'
import { emitBadgesChanged } from '@/lib/events'
import { formatLongDate, formatTime } from '@/lib/format'
import type { Client, PermissionTypeDef, SupervisorDay, Visit } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

/** Tipos que fazem sentido para a visita no estado atual. */
function applicableTypes(visit: Visit, types: PermissionTypeDef[]) {
  return types.filter((t) => {
    if (!t.needsVisit) return false
    if (t.type === 'CHECKIN_FORA_CERCA') return visit.status === 'PENDENTE' && !visit.geofenceWaived
    if (t.type === 'DISPENSA_FOTOS') return (visit.status === 'PENDENTE' || visit.status === 'EM_ATENDIMENTO') && !visit.photosWaived
    if (t.type === 'SUBSTITUIR_CLIENTE') return visit.status === 'PENDENTE'
    return visit.status === 'PENDENTE'
  })
}

/** Dia de um promotor da equipe, com liberação direta (sem pedido do promotor). */
export default function PromotorDia() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const query = useQuery(async () => {
    const [day, types] = await Promise.all([api<SupervisorDay>(`/supervisor/promotores/${id}/day`), api<PermissionTypeDef[]>('/supervisor/permission-types')])
    return { day, types }
  }, [id])
  const [visit, setVisit] = useState<Visit | null>(null)
  const [type, setType] = useState<PermissionTypeDef | null>(null)
  const [client, setClient] = useState<Client | null>(null)
  const [note, setNote] = useState('')
  const [reordering, setReordering] = useState(false)
  const [order, setOrder] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (query.loading && !query.data) return <LoadingView />
  if (query.error && !query.data) return <ErrorView message={query.error} onRetry={query.refresh} />
  const { day, types } = query.data!
  const pending = day.visits.filter((v) => v.status === 'PENDENTE')

  function openVisit(v: Visit) {
    setVisit(v)
    setType(null)
    setClient(null)
    setNote('')
    setError(null)
  }

  function closeAll() {
    setVisit(null)
    setReordering(false)
  }

  async function grant(payload: { type: string; visitId?: string; payload?: unknown }) {
    setBusy(true)
    setError(null)
    try {
      await api('/supervisor/permissions', { body: { promotorId: day.promotor.id, note: note.trim() || undefined, ...payload } })
      closeAll()
      emitBadgesChanged()
      await query.reload()
      Alert.alert('Liberação concedida', 'O promotor já vê a mudança no app dele.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const original = pending.map((v) => v.id)
  const orderChanged = order.some((vid, i) => vid !== original[i])

  return (
    <Screen refreshing={query.refreshing} onRefresh={query.refresh}>
      <Card>
        <Text style={styles.title}>{day.promotor.name}</Text>
        <Muted>{formatLongDate(day.date)}</Muted>
        <Muted>
          {day.workDay?.startedAt ? `Jornada iniciada às ${formatTime(day.workDay.startedAt)}` : 'Jornada não iniciada'}
          {day.workDay?.endedAt ? ` · encerrada às ${formatTime(day.workDay.endedAt)}` : ''}
        </Muted>
      </Card>

      <SectionTitle
        right={
          pending.length >= 2 ? (
            <Button
              title="Alterar ordem"
              variant="ghost"
              small
              onPress={() => {
                setOrder(original)
                setNote('')
                setError(null)
                setReordering(true)
              }}
            />
          ) : null
        }
      >
        Clientes
      </SectionTitle>
      <Muted>Toque num cliente para conceder uma liberação.</Muted>
      {day.visits.length === 0 ? <EmptyState title="Sem clientes neste dia" /> : null}
      {day.visits.map((v) => (
        <VisitCard key={v.id} visit={v} onPress={() => openVisit(v)} />
      ))}

      <Sheet visible={!!visit} title={visit ? `Liberar: ${visit.client.name}` : ''} onClose={closeAll}>
        {visit ? (
          <>
            {applicableTypes(visit, types).length === 0 ? <Banner tone="info" text="Nenhuma liberação disponível para esta visita no estado atual." /> : null}
            {applicableTypes(visit, types).map((t) => (
              <Pressable key={t.type} onPress={() => setType(t)} style={[styles.option, type?.type === t.type && styles.optionActive]}>
                <Text style={styles.optionText}>{t.label}</Text>
                <Muted>{t.description}</Muted>
              </Pressable>
            ))}
            {type?.type === 'SUBSTITUIR_CLIENTE' ? (
              <>
                <Text style={styles.label}>Cliente substituto</Text>
                {client ? <Banner tone="success" text={`Selecionado: ${client.name}`} /> : null}
                <ClientSearch
                  fetcher={(search) => api<Client[]>(`/supervisor/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`)}
                  onSelect={setClient}
                  selectedId={client?.id}
                />
              </>
            ) : null}
            {type ? (
              <>
                <Field label="Observação para o promotor" value={note} onChangeText={setNote} multiline placeholder="Opcional" />
                {error ? <Banner tone="danger" text={error} /> : null}
                <Button
                  title="Conceder liberação"
                  loading={busy}
                  disabled={type.type === 'SUBSTITUIR_CLIENTE' && !client}
                  onPress={() =>
                    grant({
                      type: type.type,
                      visitId: visit.id,
                      payload: type.type === 'SUBSTITUIR_CLIENTE' ? { clientId: client!.id } : undefined,
                    })
                  }
                />
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={reordering} title="Alterar ordem dos pendentes" onClose={closeAll}>
        <ReorderList items={pending.map((v) => ({ id: v.id, title: v.client.name, subtitle: v.client.address }))} order={order} original={original} onChange={setOrder} />
        <Field label="Observação para o promotor" value={note} onChangeText={setNote} multiline placeholder="Opcional" />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button title="Aplicar nova ordem" loading={busy} disabled={!orderChanged} onPress={() => grant({ type: 'ALTERAR_ORDEM', payload: { order } })} />
      </Sheet>
    </Screen>
  )
}
