import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import { api } from '../api'
import { weekdayLabel } from '../format'
import type { Client, Ref, RouteDay } from '../types'
import { ClientPicker, Empty, ErrorBox, Field, Loading, PageHead, Tabs, useLookups } from '../ui'

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function Fit({ clients }: { clients: Client[] }) {
  const map = useMap()
  const key = clients.map((c) => c.id).join()
  useEffect(() => {
    if (clients.length) map.fitBounds(L.latLngBounds(clients.map((c) => [c.latitude, c.longitude])), { padding: [30, 30], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
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
      <div className="toolbar">
        <Field label="Promotor">
          <select className="input" value={promotorId} onChange={(e) => setPromotorId(e.target.value)}>
            {lookups.data?.promotores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {lookups.isLoading && <Loading />}
      {lookups.data?.promotores.length === 0 && <Empty>Cadastre um usuário com perfil de promotor para montar o roteiro.</Empty>}
      {promotorId && <RouteEditor key={promotorId} promotorId={promotorId} />}
    </div>
  )
}

function RouteEditor({ promotorId }: { promotorId: string }) {
  const qc = useQueryClient()
  const [weekday, setWeekday] = useState(1)
  const query = useQuery({ queryKey: ['route', promotorId], queryFn: () => api<{ promotor: Ref; weekdays: RouteDay[] }>(`/admin/routes/${promotorId}`) })
  const [draft, setDraft] = useState<Client[] | null>(null)
  const saved = query.data?.weekdays.find((w) => w.weekday === weekday)?.clients ?? []
  const list = draft ?? saved
  const dirty = draft !== null

  const save = useMutation({
    mutationFn: () => api(`/admin/routes/${promotorId}/${weekday}`, { method: 'PUT', body: { clientIds: list.map((c) => c.id) } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['route', promotorId] })
      setDraft(null)
    },
  })

  const changeDay = (d: number) => {
    if (dirty && !confirm('Descartar as alterações deste dia?')) return
    setDraft(null)
    setWeekday(d)
  }
  const move = (i: number, delta: number) => {
    const next = [...list]
    const [item] = next.splice(i, 1)
    next.splice(i + delta, 0, item!)
    setDraft(next)
  }

  if (query.isLoading) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  return (
    <>
      <Tabs
        value={String(weekday)}
        onChange={(v) => changeDay(Number(v))}
        options={WEEK_ORDER.map((d) => ({ value: String(d), label: `${weekdayLabel[d]} (${query.data?.weekdays.find((w) => w.weekday === d)?.clients.length ?? 0})` }))}
      />
      <div className="cols-2">
        <section className="panel">
          <div className="panel-head">
            <h2>
              {weekdayLabel[weekday]}: {list.length} clientes
            </h2>
            <div className="btn-row">
              {dirty && (
                <button className="btn" onClick={() => setDraft(null)}>
                  Descartar
                </button>
              )}
              <button className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                Salvar roteiro de {weekdayLabel[weekday].toLowerCase()}
              </button>
            </div>
          </div>
          <div className="panel-body stack">
            <ClientPicker onPick={(c) => setDraft([...list, c])} placeholder="Adicionar cliente ao final do roteiro" />
            <ErrorBox error={save.error} />
            {list.length === 0 ? (
              <Empty>Nenhum cliente neste dia. Busque acima para adicionar.</Empty>
            ) : (
              <ol className="route-list">
                {list.map((c, i) => (
                  <li key={`${c.id}-${i}`}>
                    <span className="route-num">{i + 1}</span>
                    <span>
                      {c.code && <span className="muted">{c.code} </span>}
                      {c.name}
                      <div className="small muted">{[c.address, c.city].filter(Boolean).join(', ')}</div>
                    </span>
                    <span className="btn-row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                      <button className="btn icon" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button className="btn icon" aria-label="Descer" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                      <button className="btn icon danger" aria-label="Remover" onClick={() => setDraft(list.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
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
                key={`${c.id}-${i}`}
                position={[c.latitude, c.longitude]}
                icon={L.divIcon({ className: '', html: `<div class="pin EM_ATENDIMENTO">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })}
                title={c.name}
              />
            ))}
          </MapContainer>
        </section>
      </div>
    </>
  )
}
