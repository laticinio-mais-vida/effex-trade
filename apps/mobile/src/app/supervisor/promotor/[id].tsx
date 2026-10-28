import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { Banner, Button, Card, EmptyState, ErrorView, Field, LoadingView, Muted, Row, Screen, SectionTitle, Segmented, Sheet, styles } from '@/components/ui'
import { ClientSearch } from '@/features/ClientSearch'
import { ReorderList } from '@/features/ReorderList'
import { VisitCard } from '@/features/VisitCard'
import { api, errorMessage } from '@/lib/api'
import { emitBadgesChanged } from '@/lib/events'
import { addDays, DEFAULT_MODULES, formatLongDate, formatShortDay, formatTime, isDefaultStructure, MODULE_ORDER, moduleLabels, structureLabel } from '@/lib/format'
import { colors, radius, space } from '@/lib/theme'
import type { Client, PermissionTypeDef, ScheduledVisit, SupervisorDay, Visit, VisitModule } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

/** Tipos que fazem sentido para a visita no estado atual. orderApplies: a ordem do roteiro vale hoje e o dia não foi liberado. */
function applicableTypes(visit: Visit, types: PermissionTypeDef[], orderApplies: boolean) {
  return types.filter((t) => {
    if (!t.needsVisit) return false
    if (t.type === 'CHECKIN_FORA_CERCA') return visit.status === 'PENDENTE' && !visit.geofenceWaived
    if (t.type === 'DISPENSA_FOTOS') return (visit.status === 'PENDENTE' || visit.status === 'EM_ATENDIMENTO') && !visit.photosWaived
    if (t.type === 'LIVRE_ORDEM_CLIENTE') {
      return orderApplies && visit.status === 'PENDENTE' && visit.origin !== 'EXTRA' && visit.origin !== 'PONTUAL' && !visit.routeOrderWaived
    }
    if (t.type === 'SUBSTITUIR_CLIENTE') return visit.status === 'PENDENTE'
    return visit.status === 'PENDENTE'
  })
}

const moduleHelp: Record<VisitModule, string> = {
  FOTOS: 'Fotos de antes e depois e confirmação de ruptura',
  ATIVIDADES: 'Atividade extra que você escreve abaixo (e as já cadastradas para o cliente)',
  ESTOQUE: 'Contagem feita fora do app: o promotor só confirma que fez',
}
const onlyActivities = (modules: VisitModule[]) => modules.length === 1 && modules[0] === 'ATIVIDADES'

/** Cliente que já está no dia de hoje (a API recusa incluí-lo de novo como visita pontual). */
const busyToday = (visits: Visit[], clientId: string) =>
  visits.some((v) => v.client.id === clientId && (v.status === 'PENDENTE' || v.status === 'EM_ATENDIMENTO' || v.status === 'CONCLUIDA'))

/** Dia de um promotor da equipe, com liberação direta (sem pedido do promotor) e inclusão de visita pontual. */
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
  const [freeDay, setFreeDay] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [modules, setModules] = useState<VisitModule[]>(DEFAULT_MODULES)
  const [activityTitle, setActivityTitle] = useState('')
  const [activityPhoto, setActivityPhoto] = useState(true)
  const [order, setOrder] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (query.loading && !query.data) return <LoadingView />
  if (query.error && !query.data) return <ErrorView message={query.error} onRetry={query.refresh} />
  const { day, types } = query.data!
  const pending = day.visits.filter((v) => v.status === 'PENDENTE')
  const dayOpen = !day.workDay?.closedAt && !day.workDay?.endedAt
  const orderApplies = !!day.routeOrderEnforced && !day.workDay?.routeOrderWaived && dayOpen
  const visitTypes = visit ? applicableTypes(visit, types, orderApplies) : []
  const upcoming = (day.scheduled ?? []).filter((s) => s.date > day.date)
  // Hoje só entra enquanto o promotor não encerrou o roteiro
  const scheduleDates = Array.from({ length: (day.scheduleDaysAhead ?? 30) + 1 }, (_, i) => addDays(day.date, i)).filter((d) => d !== day.date || dayOpen)

  function openVisit(v: Visit) {
    setVisit(v)
    setType(null)
    setClient(null)
    setNote('')
    setError(null)
  }

  function openScheduling() {
    setScheduleDate(scheduleDates[0] ?? '')
    setModules(DEFAULT_MODULES)
    setActivityTitle('')
    setActivityPhoto(true)
    setClient(null)
    setNote('')
    setError(null)
    setScheduling(true)
  }

  function closeAll() {
    setVisit(null)
    setReordering(false)
    setFreeDay(false)
    setScheduling(false)
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

  /** Liga ou desliga uma etapa; o atendimento precisa de pelo menos uma. */
  function toggleModule(m: VisitModule) {
    const next = MODULE_ORDER.filter((x) => (x === m ? !modules.includes(m) : modules.includes(x)))
    if (next.length > 0) setModules(next)
  }

  const activityReady = !onlyActivities(modules) || activityTitle.trim().length >= 3

  async function schedule() {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const title = activityTitle.trim()
      await api(`/supervisor/promotores/${day.promotor.id}/scheduled-visits`, {
        body: {
          clientId: client.id,
          date: scheduleDate,
          note: note.trim() || undefined,
          modules,
          activity: modules.includes('ATIVIDADES') && title ? { title, requiresPhoto: activityPhoto } : undefined,
        },
      })
      closeAll()
      await query.reload()
      Alert.alert(
        'Visita pontual incluída',
        scheduleDate === day.date
          ? `${client.name} entrou no fim do roteiro de hoje do promotor.`
          : `${client.name} vai aparecer no roteiro do promotor em ${formatLongDate(scheduleDate)}.`,
      )
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function cancelScheduled(s: { id: string; clientName: string; date: string }) {
    Alert.alert('Remover visita pontual?', `${s.clientName} sai do roteiro do promotor ${s.date === day.date ? 'de hoje' : `em ${formatShortDay(s.date, day.date)}`}.`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/supervisor/scheduled-visits/${s.id}`, { method: 'DELETE' })
            closeAll()
            await query.reload()
          } catch (e) {
            Alert.alert('Não foi possível remover', errorMessage(e))
          }
        },
      },
    ])
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
        {day.workDay?.routeOrderWaived ? <Banner tone="success" text="Ordem do roteiro liberada no dia inteiro." /> : null}
        <Button title="Incluir visita pontual" variant="secondary" small onPress={openScheduling} />
        {orderApplies && pending.length >= 2 ? (
          <Button
            title="Liberar o dia sem ordem do roteiro"
            variant="secondary"
            small
            onPress={() => {
              setNote('')
              setError(null)
              setFreeDay(true)
            }}
          />
        ) : null}
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

      {upcoming.length > 0 ? (
        <>
          <SectionTitle>Visitas pontuais agendadas</SectionTitle>
          {upcoming.map((s) => (
            <UpcomingCard key={s.id} item={s} today={day.date} onRemove={() => cancelScheduled({ id: s.id, clientName: s.client.name, date: s.date })} />
          ))}
        </>
      ) : null}

      <Sheet visible={!!visit} title={visit ? `Liberar: ${visit.client.name}` : ''} onClose={closeAll}>
        {visit ? (
          <>
            {visit.origin === 'PONTUAL' && visit.scheduled && visit.status === 'PENDENTE' ? (
              <Button
                title="Remover esta visita pontual"
                variant="secondary"
                small
                onPress={() => cancelScheduled({ id: visit.scheduled!.id, clientName: visit.client.name, date: visit.date })}
              />
            ) : null}
            {visitTypes.length === 0 ? <Banner tone="info" text="Nenhuma liberação disponível para esta visita no estado atual." /> : null}
            {visitTypes.map((t) => (
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

      <Sheet visible={freeDay} title="Dia sem ordem do roteiro" onClose={closeAll}>
        <Muted>{types.find((t) => t.type === 'LIVRE_ORDEM_DIA')?.description}</Muted>
        <Field label="Observação para o promotor" value={note} onChangeText={setNote} multiline placeholder="Opcional" />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button title="Conceder liberação" loading={busy} onPress={() => grant({ type: 'LIVRE_ORDEM_DIA' })} />
      </Sheet>

      <Sheet visible={scheduling} title="Visita pontual" onClose={closeAll}>
        <Muted>
          O cliente entra só no dia escolhido, fora do roteiro fixo: vai para o fim da lista do promotor e pode ser atendido a qualquer momento. Se não for
          atendido, o promotor precisa justificar.
        </Muted>
        <Text style={styles.label}>Dia</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {scheduleDates.map((d) => (
            <DateChip key={d} label={formatShortDay(d, day.date)} active={d === scheduleDate} onPress={() => setScheduleDate(d)} />
          ))}
        </ScrollView>
        <Text style={styles.label}>Cliente</Text>
        {client ? (
          <Card>
            <Text style={[styles.text, { fontWeight: '700' }]}>
              {client.code ? `${client.code} · ` : ''}
              {client.name}
            </Text>
            {client.address || client.city ? <Muted>{[client.address, client.city].filter(Boolean).join(' · ')}</Muted> : null}
            <Button title="Trocar cliente" variant="ghost" small onPress={() => setClient(null)} />
          </Card>
        ) : (
          <ClientSearch
            fetcher={(search) => api<Client[]>(`/supervisor/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`)}
            onSelect={setClient}
            note={(c) => (scheduleDate === day.date && busyToday(day.visits, c.id) ? 'Já está no roteiro de hoje deste promotor' : null)}
          />
        )}
        {client ? (
          <>
            <Text style={styles.label}>Estrutura do atendimento</Text>
            {MODULE_ORDER.map((m) => {
              const on = modules.includes(m)
              return (
                <Pressable
                  key={m}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: on && modules.length === 1 }}
                  onPress={() => toggleModule(m)}
                  style={[styles.option, on && styles.optionActive]}
                >
                  <Text style={[styles.optionText, on && { color: colors.primary }]}>
                    {on ? '☑ ' : '☐ '}
                    {moduleLabels[m]}
                  </Text>
                  <Muted>{moduleHelp[m]}</Muted>
                </Pressable>
              )
            })}
            {modules.includes('ATIVIDADES') ? (
              <>
                <Field
                  label={onlyActivities(modules) ? 'Atividade para o promotor' : 'Atividade para o promotor (opcional)'}
                  value={activityTitle}
                  onChangeText={setActivityTitle}
                  placeholder="Ex.: Colocar as placas de preço da campanha"
                  hint="Obrigatória para o check-out e feita uma vez, só nesta visita."
                />
                <Segmented
                  options={[
                    { value: 'foto', label: 'Exige foto' },
                    { value: 'sem', label: 'Sem foto' },
                  ]}
                  value={activityPhoto ? 'foto' : 'sem'}
                  onChange={(v) => setActivityPhoto(v === 'foto')}
                />
              </>
            ) : null}
            <Field label="Recado para o promotor" value={note} onChangeText={setNote} multiline placeholder="Opcional: o que fazer neste cliente" />
            {!activityReady ? <Muted>Só com atividade extra, escreva a atividade que o promotor vai fazer.</Muted> : null}
            {error ? <Banner tone="danger" text={error} /> : null}
            <Button
              title={scheduleDate === day.date ? 'Incluir no roteiro de hoje' : `Agendar para ${formatShortDay(scheduleDate, day.date).toLowerCase()}`}
              loading={busy}
              disabled={!scheduleDate || !activityReady}
              onPress={schedule}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  )
}

function DateChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: space.md,
        paddingVertical: 8,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primarySoft : colors.surface,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: active ? colors.primary : colors.text }}>{label}</Text>
    </Pressable>
  )
}

function UpcomingCard({ item, today, onRemove }: { item: ScheduledVisit; today: string; onRemove: () => void }) {
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[styles.text, { fontWeight: '700', color: colors.primary }]}>{formatShortDay(item.date, today)}</Text>
        <Muted>por {item.createdBy.name}</Muted>
      </Row>
      <Text style={[styles.sectionTitle, { fontSize: 16 }]} numberOfLines={2}>
        {item.client.name}
      </Text>
      {item.client.address ? (
        <Muted numberOfLines={1}>
          {item.client.address}
          {item.client.city ? ` · ${item.client.city}` : ''}
        </Muted>
      ) : null}
      {!isDefaultStructure(item.modules) ? <Muted>Estrutura: {structureLabel(item.modules)}</Muted> : null}
      {item.activity ? <Muted>Atividade: {item.activity.title}</Muted> : null}
      {item.note ? <Muted>Recado: {item.note}</Muted> : null}
      <View style={{ alignItems: 'flex-start' }}>
        <Button title="Remover" variant="ghost" small onPress={onRemove} />
      </View>
    </Card>
  )
}
