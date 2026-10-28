import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import { api } from '../api'
import { DEFAULT_MODULES, distanceModeLabel, fmtNumber, isDefaultStructure, MODULE_ORDER, moduleLabel, recurrenceLabel, structureLabel, today, weekdayLabel } from '../format'
import {
  DAYS_INTERVAL,
  fmtShortDay,
  frequencyError,
  frequencyLabel,
  nextVisits,
  sameFrequency,
  upcomingWeekdays,
  WEEKLY,
  weekOfMonthLabel,
  WEEKS_SKIPPED,
  withType,
} from '../routeFrequency'
import { distanceMeters, pathMeters, suggestOrder } from '../routeOrder'
import type { Client, DistanceMode, Frequency, FrequencyType, Ref, RouteClient, RouteDay, Task, VisitModule } from '../types'
import { ClientPicker, Empty, ErrorBox, Field, Loading, PageHead, Tabs, useLookups } from '../ui'
import { TaskForm } from './Tasks'

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const dayName = (d: number) => weekdayLabel[d]!.toLowerCase()
const listDays = (days: number[]) => new Intl.ListFormat('pt-BR').format(days.map(dayName))
const fmtKm = (meters: number) => `${fmtNumber(meters / 1000, 1)} km`
const sameRoute = (a: RouteClient[], b: RouteClient[]) =>
  a.length === b.length &&
  a.every((c, i) => c.id === b[i]!.id && sameFrequency(c.frequency, b[i]!.frequency) && c.modules.join() === b[i]!.modules.join())
const onlyActivities = (modules: VisitModule[]) => modules.length === 1 && modules[0] === 'ATIVIDADES'

function Fit({ clients }: { clients: Client[] }) {
  const map = useMap()
  const key = clients.map((c) => c.id).join()
  useEffect(() => {
    if (clients.length) map.fitBounds(L.latLngBounds(clients.map((c) => [c.latitude, c.longitude])), { padding: [30, 30], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}

/**
 * Distâncias entre os clientes do dia vindas da API: pelas ruas quando há servidor de rotas, senão em linha reta.
 * Só busca de novo quando muda o conjunto de clientes (reordenar não muda); enquanto isso, o par que falta vai em linha reta.
 */
function useDistances(list: Client[]) {
  const ids = [...new Set(list.map((c) => c.id))].sort()
  const query = useQuery({
    queryKey: ['route-distances', ids.join()],
    queryFn: () => api<{ clientIds: string[]; meters: number[][]; source: DistanceMode }>('/admin/route-distances', { method: 'POST', body: { clientIds: ids } }),
    enabled: ids.length > 1,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  })
  const index = new Map(query.data?.clientIds.map((id, i) => [id, i]))
  const dist = (a: Client, b: Client) => {
    const i = index.get(a.id)
    const j = index.get(b.id)
    return i != null && j != null ? query.data!.meters[i]![j]! : distanceMeters(a, b)
  }
  return { dist, source: query.data?.source ?? 'linha_reta', loading: query.isFetching }
}

export function RoutesPage() {
  const lookups = useLookups()
  const [promotorId, setPromotorId] = useState('')
  useEffect(() => {
    if (!promotorId && lookups.data?.promotores[0]) setPromotorId(lookups.data.promotores[0].id)
  }, [lookups.data, promotorId])

  return (
    <div>
      <PageHead
        title="Roteiros"
        description="Clientes que cada promotor atende em cada dia da semana, na ordem de atendimento. As mudanças valem a partir do próximo dia; o roteiro de hoje já foi gerado."
      />
      {lookups.isLoading && <Loading />}
      {lookups.data?.promotores.length === 0 && <Empty>Cadastre um usuário com perfil de promotor para montar o roteiro.</Empty>}
      {promotorId && <RouteEditor key={promotorId} promotorId={promotorId} onPromotorChange={setPromotorId} />}
    </div>
  )
}

function RouteEditor({ promotorId, onPromotorChange }: { promotorId: string; onPromotorChange: (id: string) => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const [weekday, setWeekday] = useState(1)
  const query = useQuery({ queryKey: ['route', promotorId], queryFn: () => api<{ promotor: Ref; weekdays: RouteDay[] }>(`/admin/routes/${promotorId}`) })
  /** Alterações ainda não salvas, por dia da semana; salvar grava todos os dias alterados de uma vez. */
  const [drafts, setDrafts] = useState<Partial<Record<number, RouteClient[]>>>({})
  /** Clientes marcados para entrar no roteiro e a frequência escolhida em cada dia marcado. */
  const [adding, setAdding] = useState<{ clients: Client[]; days: Partial<Record<number, Frequency>>; modules: VisitModule[] } | null>(null)
  /** Cliente da lista do dia com a frequência e a estrutura abertas para edição. */
  const [editingFreq, setEditingFreq] = useState<string | null>(null)
  /** Atalho para cadastrar atividade extra para um cliente deste promotor. */
  const [newTaskFor, setNewTaskFor] = useState<Pick<Client, 'id' | 'name'> | null>(null)
  const [suggested, setSuggested] = useState<{ weekday: number; before: number; after: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const focusAfterMove = useRef<string | null>(null)

  const savedOf = (d: number) => query.data?.weekdays.find((w) => w.weekday === d)?.clients ?? []
  const listOf = (d: number) => drafts[d] ?? savedOf(d)
  const list = listOf(weekday)
  const distances = useDistances(list)
  const km = pathMeters(list, distances.dist)
  const dirtyDays = WEEK_ORDER.filter((d) => drafts[d])
  const dirty = dirtyDays.length > 0
  const incomplete = dirtyDays.flatMap((d) => listOf(d).filter((c) => frequencyError(c.frequency)).map((c) => `${c.name} (${dayName(d)})`))
  const suggestion = suggested?.weekday === weekday && Math.abs(suggested.after - km) < 1 ? suggested : null

  /** Troca a lista de um ou mais dias; o dia que volta a ficar igual ao salvo deixa de contar como alteração. */
  const setDays = (changes: [number, RouteClient[]][]) =>
    setDrafts((prev) => {
      const next = { ...prev }
      for (const [d, clients] of changes) {
        if (sameRoute(clients, savedOf(d))) delete next[d]
        else next[d] = clients
      }
      return next
    })

  const save = useMutation({
    mutationFn: () =>
      api(`/admin/routes/${promotorId}`, {
        method: 'PUT',
        body: {
          days: dirtyDays.map((d) => ({ weekday: d, items: listOf(d).map((c) => ({ clientId: c.id, frequency: c.frequency, modules: c.modules })) })),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['route', promotorId] })
      setDrafts({})
    },
  })

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Ao mover pelo teclado o item muda de lugar na lista; devolve o foco à alça dele.
  useEffect(() => {
    if (!focusAfterMove.current) return
    listRef.current?.querySelector<HTMLButtonElement>(`[data-handle="${focusAfterMove.current}"]`)?.focus()
    focusAfterMove.current = null
  })

  const changePromotor = (id: string) => {
    if (dirty && !confirm('Descartar as alterações não salvas deste promotor?')) return
    onPromotorChange(id)
  }
  const discard = () => {
    if (!confirm(`Descartar as alterações de ${listDays(dirtyDays)}?`)) return
    setDrafts({})
    save.reset()
  }

  const inDay = (d: number, clientId: string) => listOf(d).some((c) => c.id === clientId)
  /** Seleção de vários clientes: cada clique na busca marca ou desmarca. O dia aberto já vem marcado como semanal. */
  const pick = (picked: Client[]) =>
    setAdding((a) => {
      const current = a?.clients ?? []
      const has = (id: string) => current.some((c) => c.id === id)
      const clients = picked.every((p) => has(p.id))
        ? current.filter((c) => !picked.some((p) => p.id === c.id))
        : [...current, ...picked.filter((p) => !has(p.id))]
      if (clients.length === 0) return null
      if (a) return { ...a, clients }
      return { clients, days: clients.every((c) => inDay(weekday, c.id)) ? {} : { [weekday]: WEEKLY }, modules: DEFAULT_MODULES }
    })
  const removeFromSelection = (clientId: string) =>
    setAdding((a) => (a && a.clients.length > 1 ? { ...a, clients: a.clients.filter((c) => c.id !== clientId) } : null))
  const toggleAddDay = (d: number) =>
    setAdding((a) => {
      if (!a) return a
      const { [d]: current, ...rest } = a.days
      return { ...a, days: current ? rest : { ...a.days, [d]: WEEKLY } }
    })
  const setAddFrequency = (d: number, f: Frequency) => setAdding((a) => a && { ...a, days: { ...a.days, [d]: f } })
  const setAddModules = (modules: VisitModule[]) => setAdding((a) => a && { ...a, modules })
  const confirmAdd = () => {
    if (!adding) return
    setDays(
      WEEK_ORDER.filter((d) => adding.days[d]).map((d) => [
        d,
        [...listOf(d), ...adding.clients.filter((c) => !inDay(d, c.id)).map((c) => ({ ...c, frequency: adding.days[d]!, modules: adding.modules }))],
      ]),
    )
    setAdding(null)
  }
  const setFrequency = (clientId: string, f: Frequency) => setDays([[weekday, list.map((c) => (c.id === clientId ? { ...c, frequency: f } : c))]])
  const setModules = (clientId: string, modules: VisitModule[]) => setDays([[weekday, list.map((c) => (c.id === clientId ? { ...c, modules } : c))]])

  const move = (from: number, to: number) => {
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    setDays([[weekday, next]])
  }
  /** Arrastando: o cliente troca de lugar quando o cursor passa do meio da linha vizinha. */
  const dragOver = (e: DragEvent<HTMLLIElement>, i: number) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const from = list.findIndex((c) => c.id === dragId)
    if (from === i) return
    const box = e.currentTarget.getBoundingClientRect()
    const below = e.clientY > box.top + box.height / 2
    if ((from < i && below) || (from > i && !below)) move(from, i)
  }
  const handleKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = ({ ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: list.length - 1 } as Record<string, number | undefined>)[e.key]
    if (to === undefined) return
    e.preventDefault()
    if (to < 0 || to >= list.length || to === i) return
    focusAfterMove.current = list[i]!.id
    move(i, to)
  }
  const suggest = () => {
    const next = suggestOrder(list, distances.dist)
    const after = pathMeters(next, distances.dist)
    // Empate ou ganho desprezível: mantém a ordem atual em vez de embaralhar à toa.
    if (after < km - 1) setDays([[weekday, next]])
    setSuggested({ weekday, before: km, after: Math.min(after, km) })
  }

  return (
    <>
      <div className="toolbar">
        <Field label="Promotor">
          <select className="input" value={promotorId} onChange={(e) => changePromotor(e.target.value)}>
            {lookups.data?.promotores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {query.data && (
          <Field label="Adicionar clientes" className="grow">
            <ClientPicker
              onPick={(c) => pick([c])}
              onPickMany={pick}
              selectedIds={adding?.clients.map((c) => c.id) ?? []}
              placeholder="Buscar e marcar clientes por nome, código ou cidade"
            />
          </Field>
        )}
      </div>

      {adding && (
        <AddClients
          clients={adding.clients}
          days={adding.days}
          modules={adding.modules}
          onModules={setAddModules}
          alreadyIn={(d) => adding.clients.filter((c) => inDay(d, c.id)).length}
          onRemoveClient={removeFromSelection}
          onToggleDay={toggleAddDay}
          onFrequency={setAddFrequency}
          onCancel={() => setAdding(null)}
          onConfirm={confirmAdd}
        />
      )}

      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && (
        <>
          <Tabs
            value={String(weekday)}
            onChange={(v) => setWeekday(Number(v))}
            options={WEEK_ORDER.map((d) => ({ value: String(d), label: `${weekdayLabel[d]} (${listOf(d).length})${drafts[d] ? ' •' : ''}` }))}
          />
          <div className="cols-2">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>
                    {weekdayLabel[weekday]}: {list.length} clientes
                  </h2>
                  {list.length > 1 && (
                    <div className="small muted">
                      Deslocamento estimado: {fmtKm(km)} {distances.loading ? '…' : distanceModeLabel[distances.source]}
                    </div>
                  )}
                </div>
                <button
                  className="btn"
                  disabled={list.length < 3 || distances.loading}
                  title={list.length < 3 ? 'A sugestão precisa de pelo menos 3 clientes no dia.' : `Reordena os clientes pelo menor deslocamento ${distanceModeLabel[distances.source]}.`}
                  onClick={suggest}
                >
                  Usar sugestão de ordenação
                </button>
              </div>
              <div className="panel-body stack">
                {suggestion && (
                  <div className="alert ok">
                    {suggestion.before - suggestion.after < 1
                      ? 'A ordem atual já é a de menor deslocamento.'
                      : `Ordem sugerida aplicada: ${fmtKm(suggestion.before)} → ${fmtKm(suggestion.after)} (${fmtKm(suggestion.before - suggestion.after)} a menos). Ajuste se precisar e salve.`}
                  </div>
                )}
                {list.length === 0 ? (
                  <Empty>Nenhum cliente neste dia. Use “Adicionar cliente”, acima, para incluir.</Empty>
                ) : (
                  <div>
                    <p className="small muted" style={{ margin: '0 0 8px' }}>
                      Arraste os clientes para cima ou para baixo para mudar a ordem de atendimento.
                    </p>
                    <ol className="route-list sortable" ref={listRef}>
                      {list.map((c, i) => (
                        <li
                          key={c.id}
                          draggable={editingFreq !== c.id}
                          className={dragId === c.id ? 'dragging' : undefined}
                          onDragStart={(e) => {
                            setDragId(c.id)
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', c.name)
                          }}
                          onDragOver={(e) => dragOver(e, i)}
                          onDrop={(e) => e.preventDefault()}
                          onDragEnd={() => setDragId(null)}
                        >
                          <button
                            type="button"
                            className="drag-handle"
                            data-handle={c.id}
                            aria-label={`${c.name}, posição ${i + 1} de ${list.length}. Arraste ou use as setas para mudar a posição.`}
                            onKeyDown={(e) => handleKey(e, i)}
                          >
                            <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                              {[2, 8].flatMap((x) => [3, 8, 13].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
                            </svg>
                          </button>
                          <span className="route-num">{i + 1}</span>
                          <span>
                            {c.code && <span className="muted">{c.code} </span>}
                            {c.name}
                            <div className="small muted">{[c.address, c.city].filter(Boolean).join(', ')}</div>
                            <button
                              type="button"
                              className={`freq-chip${c.frequency.type === 'SEMANAL' && isDefaultStructure(c.modules) ? '' : ' custom'}${frequencyError(c.frequency) ? ' bad' : ''}`}
                              aria-expanded={editingFreq === c.id}
                              title="Alterar a frequência e a estrutura do atendimento"
                              onClick={() => setEditingFreq(editingFreq === c.id ? null : c.id)}
                            >
                              {frequencyLabel(weekday, c.frequency)}
                              {c.frequency.type !== 'SEMANAL' && !frequencyError(c.frequency) && ` · próxima ${fmtShortDay(nextVisits(weekday, c.frequency, 1)[0]!)}`}
                              {!isDefaultStructure(c.modules) && ` · ${structureLabel(c.modules)}`}
                            </button>
                          </span>
                          <button
                            className="btn icon danger"
                            aria-label={`Remover ${c.name} de ${dayName(weekday)}`}
                            onClick={() => setDays([[weekday, list.filter((_, j) => j !== i)]])}
                          >
                            ✕
                          </button>
                          {editingFreq === c.id && (
                            <div className="freq-edit">
                              <div className="freq-edit-section">
                                <h4>Frequência</h4>
                                <FrequencyPicker weekday={weekday} value={c.frequency} onChange={(f) => setFrequency(c.id, f)} name={`edit-${c.id}`} />
                              </div>
                              <div className="freq-edit-section">
                                <h4>Estrutura do atendimento</h4>
                                <StructurePicker value={c.modules} onChange={(m) => setModules(c.id, m)} />
                              </div>
                              {c.modules.includes('ATIVIDADES') && (
                                <div className="freq-edit-section">
                                  <h4>Atividades extras deste cliente</h4>
                                  <ClientTasks clientId={c.id} promotorId={promotorId} onNew={() => setNewTaskFor(c)} />
                                </div>
                              )}
                              <div className="btn-row">
                                <button type="button" className="btn small" onClick={() => setEditingFreq(null)}>
                                  Fechar
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </section>
            <section className="panel" style={{ height: 460, overflow: 'hidden' }}>
              <MapContainer center={[-12.97, -38.48]} zoom={12} style={{ height: '100%' }}>
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Fit clients={list} />
                {list.length > 1 && <Polyline positions={list.map((c) => [c.latitude, c.longitude] as [number, number])} pathOptions={{ color: '#14213d', weight: 2, opacity: 0.5 }} />}
                {list.map((c, i) => (
                  <Marker
                    key={c.id}
                    position={[c.latitude, c.longitude]}
                    icon={L.divIcon({ className: '', html: `<div class="pin EM_ATENDIMENTO">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })}
                    title={c.name}
                  />
                ))}
              </MapContainer>
            </section>
          </div>
        </>
      )}

      {newTaskFor && <TaskForm task={null} preset={{ client: newTaskFor, promotorId }} onClose={() => setNewTaskFor(null)} />}

      {dirty && (
        <div className="savebar" role="region" aria-label="Alterações não salvas">
          <span>Alterações não salvas em {listDays(dirtyDays)}.</span>
          <div className="btn-row">
            <button className="btn" disabled={save.isPending} onClick={discard}>
              Descartar
            </button>
            <button className="btn accent" disabled={save.isPending || incomplete.length > 0} onClick={() => save.mutate()}>
              {save.isPending ? 'Salvando…' : 'Salvar roteiro'}
            </button>
          </div>
          {incomplete.length > 0 && (
            <div className="savebar-error small">Complete a frequência de {new Intl.ListFormat('pt-BR').format(incomplete)} para salvar.</div>
          )}
          {save.error && (
            <div className="savebar-error">
              <ErrorBox error={save.error} />
            </div>
          )}
        </div>
      )}
    </>
  )
}

const FREQUENCY_OPTIONS: { value: FrequencyType | 'PERSONALIZADO'; label: string }[] = [
  { value: 'SEMANAL', label: 'Semanal' },
  { value: 'QUINZENAL', label: 'Quinzenal' },
  { value: 'MENSAL', label: 'Mensal' },
  { value: 'PERSONALIZADO', label: 'Personalizado' },
]

/** Frequência de um cliente num dia da semana: semanal, quinzenal, mensal ou personalizada (de X em X dias ou pulando X semanas). */
function FrequencyPicker({ weekday, value, onChange, name }: { weekday: number; value: Frequency; onChange: (f: Frequency) => void; name: string }) {
  const custom = value.type === 'DIAS' || value.type === 'SEMANAS'
  const error = frequencyError(value)
  const starts = upcomingWeekdays(weekday)
  if (value.startDate && !starts.includes(value.startDate)) starts.unshift(value.startDate)
  const setInterval = (raw: string) => onChange({ ...value, interval: raw === '' ? null : Math.trunc(Number(raw)) })
  return (
    <div className="freq">
      <div className="segmented small" role="group" aria-label={`Frequência em ${dayName(weekday)}`}>
        {FREQUENCY_OPTIONS.map((o) => {
          const on = o.value === 'PERSONALIZADO' ? custom : value.type === o.value
          return (
            <button
              key={o.value}
              type="button"
              className={on ? 'on' : ''}
              aria-pressed={on}
              onClick={() => onChange(withType(weekday, value, o.value === 'PERSONALIZADO' ? (custom ? value.type : 'SEMANAS') : o.value))}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {custom && (
        <div className="freq-custom" role="radiogroup" aria-label="Frequência personalizada">
          <label>
            <input type="radio" name={name} checked={value.type === 'DIAS'} onChange={() => onChange(withType(weekday, value, 'DIAS'))} />
            De
            <input
              type="number"
              className="input num"
              aria-label="Intervalo em dias"
              min={DAYS_INTERVAL.min}
              max={DAYS_INTERVAL.max}
              disabled={value.type !== 'DIAS'}
              value={value.type === 'DIAS' ? (value.interval ?? '') : ''}
              onChange={(e) => setInterval(e.target.value)}
            />
            em {value.type === 'DIAS' && value.interval ? value.interval : 'X'} dias
          </label>
          <label>
            <input type="radio" name={name} checked={value.type === 'SEMANAS'} onChange={() => onChange(withType(weekday, value, 'SEMANAS'))} />
            Pulando
            <input
              type="number"
              className="input num"
              aria-label="Semanas puladas"
              min={WEEKS_SKIPPED.min}
              max={WEEKS_SKIPPED.max}
              disabled={value.type !== 'SEMANAS'}
              value={value.type === 'SEMANAS' ? (value.interval ?? '') : ''}
              onChange={(e) => setInterval(e.target.value)}
            />
            {value.type === 'SEMANAS' && value.interval === 1 ? 'semana' : 'semanas'}
          </label>
        </div>
      )}
      {value.type !== 'SEMANAL' && (
        <label className="freq-start">
          Primeira visita
          <select className="input" value={value.startDate ?? ''} onChange={(e) => onChange({ ...value, startDate: e.target.value })}>
            {starts.map((d) => (
              <option key={d} value={d}>
                {fmtShortDay(d)}
                {value.type === 'MENSAL' ? ` (${weekOfMonthLabel(weekday, d)})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {error ? (
        <div className="small freq-error">Falta completar: {error}.</div>
      ) : (
        value.type !== 'SEMANAL' && (
          <div className="small muted">
            Próximas visitas: {nextVisits(weekday, value).map(fmtShortDay).join(', ')}
            {value.type === 'DIAS' &&
              value.interval! % 7 !== 0 &&
              '. Quando cair em outro dia da semana, o cliente entra no fim da ordem daquele dia; quando cair no domingo, passa para a segunda.'}
          </div>
        )
      )}
    </div>
  )
}

/** Clientes marcados na busca e, para cada dia da semana marcado, a frequência (semanal já vem escolhida). */
function AddClients({
  clients,
  days,
  modules,
  onModules,
  alreadyIn,
  onRemoveClient,
  onToggleDay,
  onFrequency,
  onCancel,
  onConfirm,
}: {
  clients: Client[]
  days: Partial<Record<number, Frequency>>
  modules: VisitModule[]
  onModules: (modules: VisitModule[]) => void
  alreadyIn: (d: number) => number
  onRemoveClient: (clientId: string) => void
  onToggleDay: (d: number) => void
  onFrequency: (d: number, f: Frequency) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const n = clients.length
  const selected = WEEK_ORDER.filter((d) => days[d])
  const incomplete = selected.some((d) => frequencyError(days[d]!))
  return (
    <section className="panel add-client" aria-label="Adicionar clientes ao roteiro">
      <div className="add-client-who">
        <strong>{n === 1 ? '1 cliente selecionado' : `${n} clientes selecionados`}</strong>
        <div className="small muted">Continue buscando acima para marcar mais clientes.</div>
        <ul className="client-chips">
          {clients.map((c) => (
            <li key={c.id} className="client-chip" title={[c.address, c.city].filter(Boolean).join(', ')}>
              <span>
                {c.code && <span className="muted">{c.code} </span>}
                {c.name}
              </span>
              <button type="button" aria-label={`Tirar ${c.name} da seleção`} onClick={() => onRemoveClient(c.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="add-client-structure">
          <strong className="small">Estrutura do atendimento</strong>
          <div className="small muted">Vale para todos os dias marcados; depois dá para mudar cliente a cliente.</div>
          <StructurePicker value={modules} onChange={onModules} />
        </div>
      </div>
      <fieldset className="add-client-days">
        <legend className="small muted">Em quais dias? Os clientes entram no final da ordem de cada dia.</legend>
        {WEEK_ORDER.map((d) => {
          const has = alreadyIn(d)
          const all = has === n
          const f = days[d]
          return (
            <div key={d} className={`day-freq${f ? ' on' : ''}`}>
              <label className="day-check">
                <input type="checkbox" checked={!!f} disabled={all} onChange={() => onToggleDay(d)} />
                <span className="day-name">{weekdayLabel[d]}</span>
                {has > 0 && (
                  <span className="small muted">
                    {all
                      ? n === 1
                        ? 'já está neste dia'
                        : 'todos já estão neste dia'
                      : `${has} de ${n} já ${has === 1 ? 'está' : 'estão'} neste dia e não se repete${has === 1 ? '' : 'm'}`}
                  </span>
                )}
              </label>
              {f && <FrequencyPicker weekday={d} value={f} onChange={(v) => onFrequency(d, v)} name={`add-${d}`} />}
            </div>
          )
        })}
      </fieldset>
      <div className="btn-row add-client-actions">
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn primary" disabled={selected.length === 0 || incomplete} onClick={onConfirm}>
          {selected.length === 0
            ? 'Adicionar'
            : `Adicionar ${n === 1 ? '' : `${n} clientes `}em ${selected.length} ${selected.length === 1 ? 'dia' : 'dias'}`}
        </button>
      </div>
    </section>
  )
}

const MODULE_HELP: Record<VisitModule, string> = {
  FOTOS: 'Fotos de antes e depois e confirmação de ruptura',
  ATIVIDADES: 'As atividades extras do cliente, na recorrência de cada uma',
  ESTOQUE: 'Contagem feita fora do app: o promotor só confirma',
}

/** Etapas do atendimento em qualquer combinação (pelo menos uma). Padrão de todo cliente novo: padrão + atividade extra. */
function StructurePicker({ value, onChange }: { value: VisitModule[]; onChange: (modules: VisitModule[]) => void }) {
  const toggle = (m: VisitModule) => {
    const next = MODULE_ORDER.filter((x) => (x === m ? !value.includes(m) : value.includes(x)))
    if (next.length > 0) onChange(next)
  }
  return (
    <div className="structure" role="group" aria-label="Estrutura do atendimento">
      {MODULE_ORDER.map((m) => {
        const on = value.includes(m)
        return (
          <label key={m} className={`structure-opt${on ? ' on' : ''}`} title={on && value.length === 1 ? 'O atendimento precisa de pelo menos uma etapa' : undefined}>
            <input type="checkbox" checked={on} disabled={on && value.length === 1} onChange={() => toggle(m)} />
            <span>
              <strong>{moduleLabel[m]}</strong>
              <span className="small muted">{MODULE_HELP[m]}</span>
            </span>
          </label>
        )
      })}
      {onlyActivities(value) && (
        <div className="small structure-note">Só com atividade extra: o cliente entra no roteiro apenas nos dias em que houver atividade para fazer.</div>
      )}
    </div>
  )
}

/** Atividades extras ativas que valem para o cliente com este promotor, com atalho para cadastrar outra. */
function ClientTasks({ clientId, promotorId, onNew }: { clientId: string; promotorId: string; onNew: () => void }) {
  const query = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/admin/tasks') })
  const t0 = today()
  const tasks = (query.data ?? []).filter(
    (t) =>
      t.active &&
      !t.scheduledVisitId &&
      (!t.endDate || t.endDate >= t0) &&
      (t.clientId === null || t.clientId === clientId) &&
      (t.promotorId === null || t.promotorId === promotorId),
  )
  return (
    <div className="client-tasks">
      {query.isLoading ? (
        <span className="small muted">Carregando…</span>
      ) : tasks.length === 0 ? (
        <span className="small muted">Nenhuma atividade ativa para este cliente.</span>
      ) : (
        // Sem ul/li: dentro da lista do roteiro, os li herdariam o layout das linhas de cliente
        <div className="client-tasks-list">
          {tasks.map((t) => (
            <div key={t.id}>
              {t.title}{' '}
              <span className="small muted">
                · {recurrenceLabel[t.recurrence]}
                {t.clientId === null ? ' · todos os clientes' : ''}
                {t.requiresPhoto ? ' · com foto' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn small" onClick={onNew}>
        Nova atividade para este cliente
      </button>
    </div>
  )
}
