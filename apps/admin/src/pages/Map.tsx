import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { fmtTime, initials, originLabel, timeAgo, today, visitStatusLabel } from '../format'
import type { MapData } from '../types'
import { ErrorBox, ExecBar, Field, StatusPill } from '../ui'

const STALE_MIN = 15

type MapVisit = MapData['visits'][number]
/** Visitas de clientes com localização (os sem localização não têm como aparecer no mapa). */
const located = (visits: MapVisit[]) =>
  visits.filter((v): v is MapVisit & { client: { latitude: number; longitude: number } } => v.client.latitude != null && v.client.longitude != null)

function pinIcon(status: string, label: string | number) {
  return L.divIcon({ className: '', html: `<div class="pin ${status}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14] })
}

function personIcon(name: string, stale: boolean) {
  return L.divIcon({ className: '', html: `<div class="person ${stale ? 'stale' : ''}">${initials(name)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] })
}

/** Enquadra o mapa quando muda o filtro (não a cada atualização, para não tirar o gestor do lugar). */
function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap()
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    if (done === fitKey || points.length === 0) return
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 })
    setDone(fitKey)
  }, [fitKey, points, done, map])
  return null
}

function useCountdown(updatedAt: number, seconds: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Math.round((updatedAt + seconds * 1000 - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

export function MapPage() {
  const [params, setParams] = useSearchParams()
  const promotorId = params.get('promotor') ?? ''
  const [date, setDate] = useState(today())
  const [refresh, setRefresh] = useState(180)

  const query = useQuery({
    queryKey: ['map', date, promotorId],
    queryFn: () => api<MapData>('/admin/map', { query: { date, promotorId } }),
    refetchInterval: refresh * 1000,
  })
  useEffect(() => {
    if (query.data?.refreshSeconds) setRefresh(query.data.refreshSeconds)
  }, [query.data?.refreshSeconds])
  const countdown = useCountdown(query.dataUpdatedAt, refresh)

  // Lista lateral sempre com todos os promotores (para trocar o filtro)
  const all = useQuery({
    queryKey: ['map', date, ''],
    queryFn: () => api<MapData>('/admin/map', { query: { date } }),
    refetchInterval: refresh * 1000,
    enabled: !!promotorId,
  })
  const list = (promotorId ? all.data : query.data)?.promotores ?? []
  const data = query.data
  const names = useMemo(() => new Map(list.map((p) => [p.id, p.name])), [list])

  const points = useMemo<[number, number][]>(() => {
    if (!data) return []
    return [
      ...located(data.visits).map((v) => [v.client.latitude, v.client.longitude] as [number, number]),
      ...data.promotores.filter((p) => p.lastPing).map((p) => [p.lastPing!.latitude, p.lastPing!.longitude] as [number, number]),
    ]
  }, [data])

  const select = (id: string) => setParams(id ? { promotor: id } : {})
  const selected = data?.promotores.find((p) => p.id === promotorId)

  return (
    <div className="map-page">
      <aside className="map-side">
        <div className="map-side-head">
          <h1 style={{ fontSize: 24 }}>Mapa da rota</h1>
          <div className="btn-row" style={{ alignItems: 'flex-end' }}>
            <Field label="Data">
              <input className="input" type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <button className="btn" onClick={() => query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>
          <span className="muted small">
            {date === today() ? `Próxima atualização em ${countdown}` : 'Dia encerrado: posição final de cada promotor.'}
          </span>
        </div>
        <div className="map-list">
          <button className={`map-item ${!promotorId ? 'on' : ''}`} onClick={() => select('')}>
            <div className="map-item-top">
              <strong>Todos os promotores</strong>
              <span className="muted small num">{list.length}</span>
            </div>
          </button>
          {list.map((p) => {
            const stale = !p.lastPing || Date.now() - new Date(p.lastPing.recordedAt).getTime() > STALE_MIN * 60_000
            return (
              <button key={p.id} className={`map-item ${p.id === promotorId ? 'on' : ''}`} onClick={() => select(p.id)}>
                <div className="map-item-top">
                  <strong>{p.name}</strong>
                  <span className="num small">
                    {p.stats.done}/{p.stats.total}
                  </span>
                </div>
                <ExecBar stats={p.stats} />
                <span className="small muted">
                  {p.lunch && !p.lunch.end ? (
                    <span style={{ color: p.lunch.overdue ? 'var(--notdone)' : undefined, fontWeight: p.lunch.overdue ? 600 : undefined }}>
                      Em almoço desde {fmtTime(p.lunch.start)}
                      {p.lunch.overdue ? ', acima do limite (supervisor alertado)' : ''}.{' '}
                    </span>
                  ) : (
                    ''
                  )}
                  {p.currentVisit ? `Em ${p.currentVisit.clientName} desde ${fmtTime(p.currentVisit.since)}. ` : ''}
                  <span style={{ color: stale && date === today() ? 'var(--notdone)' : undefined }}>
                    {p.lastPing ? `Último sinal ${timeAgo(p.lastPing.recordedAt)}` : 'Sem sinal no dia'}
                  </span>
                </span>
              </button>
            )
          })}
          {selected && data && (
            <div style={{ padding: '14px 18px' }}>
              <h3 style={{ marginBottom: 8 }}>Clientes de {selected.name.split(' ')[0]}</h3>
              <ol className="route-list">
                {data.visits.map((v) => (
                  <li key={v.id}>
                    <span className="route-num">{v.position}</span>
                    <span>
                      {v.client.name}
                      <br />
                      <span className="small muted">
                        {v.checkinAt ? `${fmtTime(v.checkinAt)}–${fmtTime(v.checkoutAt)}` : v.justification ? v.justification.reason : originLabel[v.origin]}
                      </span>
                    </span>
                    <StatusPill status={v.status} />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </aside>

      <div className="map-canvas">
        {query.error && (
          <div className="map-overlay" style={{ left: 14, right: 'auto' }}>
            <ErrorBox error={query.error} />
          </div>
        )}
        <div className="map-overlay">
          <div className="legend">
            <span><i style={{ background: 'var(--done)' }} />Feito</span>
            <span><i style={{ background: 'var(--justified)' }} />Justificado</span>
            <span><i style={{ background: 'var(--progress)' }} />Em atendimento</span>
            <span><i style={{ background: 'var(--notdone)' }} />Não feito</span>
          </div>
          <span className="muted">Número no pino = ordem no roteiro. Círculo com iniciais = promotor.</span>
        </div>
        <MapContainer center={[-12.97, -38.48]} zoom={12} scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={points} fitKey={`${date}|${promotorId}`} />
          {data && data.trail.length > 1 && (
            <Polyline positions={data.trail.map((t) => [t.latitude, t.longitude] as [number, number])} pathOptions={{ color: '#14213d', weight: 3, opacity: 0.55, dashArray: '6 6' }} />
          )}
          {located(data?.visits ?? []).map((v) => (
            <Marker key={v.id} position={[v.client.latitude, v.client.longitude]} icon={pinIcon(v.status, v.position)}>
              <Popup>
                <strong>{v.client.name}</strong>
                <br />
                {[v.client.city, v.client.state].filter(Boolean).join(' - ')}
                <br />
                Promotor: {names.get(v.promotorId) ?? '—'} · {v.position}º do roteiro ({originLabel[v.origin]})
                <br />
                <strong>{visitStatusLabel[v.status]}</strong>
                {v.checkinAt && ` · check-in ${fmtTime(v.checkinAt)}`}
                {v.checkoutAt && ` · check-out ${fmtTime(v.checkoutAt)}`}
                {v.autoClosed && ' (encerrado automaticamente na última foto)'}
                {v.justification && (
                  <>
                    <br />
                    {v.justification.reason}: {v.justification.text}
                  </>
                )}
              </Popup>
            </Marker>
          ))}
          {data?.promotores
            .filter((p) => p.lastPing)
            .map((p) => {
              const stale = Date.now() - new Date(p.lastPing!.recordedAt).getTime() > STALE_MIN * 60_000
              return (
                <Marker key={p.id} position={[p.lastPing!.latitude, p.lastPing!.longitude]} icon={personIcon(p.name, stale)} zIndexOffset={1000}>
                  <Popup>
                    <strong>{p.name}</strong>
                    <br />
                    Última posição {timeAgo(p.lastPing!.recordedAt)} ({fmtTime(p.lastPing!.recordedAt)})
                    {p.lastPing!.accuracy != null && <> · precisão {Math.round(p.lastPing!.accuracy)} m</>}
                    {p.lastPing!.battery != null && <> · bateria {Math.round(p.lastPing!.battery * 100)}%</>}
                    {p.lastPing!.mocked && (
                      <>
                        <br />
                        <strong style={{ color: 'var(--notdone)' }}>Localização simulada detectada</strong>
                      </>
                    )}
                    <br />
                    {p.lunch && !p.lunch.end
                      ? `Em almoço desde ${fmtTime(p.lunch.start)}${p.lunch.overdue ? ' (acima do limite)' : ''}`
                      : p.currentVisit
                        ? `Atendendo ${p.currentVisit.clientName}`
                        : 'Em deslocamento ou parado'}
                    {p.workStart && (
                      <>
                        <br />
                        Início do trabalho {fmtTime(p.workStart)}
                        {p.lunch?.end && `, almoço ${fmtTime(p.lunch.start)}–${fmtTime(p.lunch.end)}`}
                        {p.workEnd && `, fim ${fmtTime(p.workEnd)}`}
                      </>
                    )}
                    <br />
                    Feitos {p.stats.done} de {p.stats.total}
                    {p.phone && (
                      <>
                        <br />
                        {p.phone}
                      </>
                    )}
                  </Popup>
                </Marker>
              )
            })}
        </MapContainer>
      </div>
    </div>
  )
}
