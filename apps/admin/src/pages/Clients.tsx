import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { api } from '../api'
import { parseCsv } from '../format'
import type { Client, Paged, ProductRef, SettingsResponse } from '../types'
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, ProductPicker, useLookups } from '../ui'

const PAGE_SIZE = 50

type Form = {
  code: string
  name: string
  tradeName: string
  document: string
  address: string
  city: string
  state: string
  latitude: string
  longitude: string
  geofenceRadius: string
  sellerId: string
  active: boolean
}

const emptyForm: Form = { code: '', name: '', tradeName: '', document: '', address: '', city: '', state: '', latitude: '', longitude: '', geofenceRadius: '', sellerId: '', active: true }

export function ClientsPage() {
  const lookups = useLookups()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sellerId, setSellerId] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Client | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useQuery({
    queryKey: ['clients', debounced, sellerId, page],
    queryFn: () => api<Paged<Client>>('/admin/clients', { query: { search: debounced, sellerId, page, pageSize: PAGE_SIZE } }),
  })

  return (
    <div>
      <PageHead
        title="Clientes"
        description="Pontos de venda atendidos pelos promotores. A localização define a cerca eletrônica do check-in."
        actions={
          <>
            <button className="btn" onClick={() => setImporting(true)}>
              Importar planilha
            </button>
            <button className="btn primary" onClick={() => setEditing('new')}>
              Novo cliente
            </button>
          </>
        }
      />
      <div className="toolbar">
        <Field label="Buscar">
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, código ou cidade" style={{ minWidth: 260 }} />
        </Field>
        <Field label="Vendedor">
          <select
            className="input"
            value={sellerId}
            onChange={(e) => {
              setSellerId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Todos</option>
            {lookups.data?.vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && query.data.items.length === 0 && <Empty>Nenhum cliente encontrado.</Empty>}
      {query.data && query.data.items.length > 0 && (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Endereço</th>
                <th>Vendedor</th>
                <th className="r">Raio da cerca</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                  <td className="num">{c.code ?? '—'}</td>
                  <td>
                    <strong>{c.name}</strong>
                    {c.tradeName && <div className="small muted">{c.tradeName}</div>}
                  </td>
                  <td>{[c.address, c.city, c.state].filter(Boolean).join(', ')}</td>
                  <td>{c.seller?.name ?? <span className="muted">—</span>}</td>
                  <td className="r">{c.geofenceRadius ? `${c.geofenceRadius} m` : <span className="muted">padrão</span>}</td>
                  <td>{c.active ? 'Ativo' : <span className="muted">Inativo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.data && <Pager page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={setPage} />}
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <ImportClients onClose={() => setImporting(false)} />}
    </div>
  )
}

function PickLocation({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 15))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function ClientForm({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/admin/settings') })
  const defaultRadius = Number(settings.data?.values.geofenceRadiusMeters ?? 150)
  const [form, setForm] = useState<Form>(() =>
    client
      ? {
          code: client.code ?? '',
          name: client.name,
          tradeName: client.tradeName ?? '',
          document: client.document ?? '',
          address: client.address ?? '',
          city: client.city ?? '',
          state: client.state ?? '',
          latitude: String(client.latitude),
          longitude: String(client.longitude),
          geofenceRadius: client.geofenceRadius ? String(client.geofenceRadius) : '',
          sellerId: client.sellerId ?? '',
          active: client.active,
        }
      : emptyForm,
  )
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const lat = Number(form.latitude.replace(',', '.'))
  const lng = Number(form.longitude.replace(',', '.'))
  const hasPoint = form.latitude !== '' && form.longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng)

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code || null,
        name: form.name,
        tradeName: form.tradeName || null,
        document: form.document || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state ? form.state.toUpperCase() : null,
        latitude: lat,
        longitude: lng,
        geofenceRadius: form.geofenceRadius ? Number(form.geofenceRadius) : null,
        sellerId: form.sellerId || null,
        active: form.active,
      }
      return client ? api(`/admin/clients/${client.id}`, { method: 'PATCH', body }) : api('/admin/clients', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      onClose()
    },
  })

  return (
    <Modal
      wide
      title={client ? client.name : 'Novo cliente'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || !form.name || !hasPoint}>
            {client ? 'Salvar cliente' : 'Cadastrar cliente'}
          </button>
        </>
      }
    >
      <div className="cols-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="form-grid">
          <Field label="Código no ERP">
            <input className="input" value={form.code} onChange={(e) => set({ code: e.target.value })} />
          </Field>
          <Field label="CNPJ">
            <input className="input" value={form.document} onChange={(e) => set({ document: e.target.value })} />
          </Field>
          <Field label="Razão social / nome" className="full">
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Nome fantasia" className="full">
            <input className="input" value={form.tradeName} onChange={(e) => set({ tradeName: e.target.value })} />
          </Field>
          <Field label="Endereço" className="full">
            <input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label="Cidade">
            <input className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field label="UF">
            <input className="input" maxLength={2} value={form.state} onChange={(e) => set({ state: e.target.value })} />
          </Field>
          <Field label="Latitude">
            <input className="input num" value={form.latitude} onChange={(e) => set({ latitude: e.target.value })} placeholder="-12.9714" />
          </Field>
          <Field label="Longitude">
            <input className="input num" value={form.longitude} onChange={(e) => set({ longitude: e.target.value })} placeholder="-38.5014" />
          </Field>
          <Field label={`Raio da cerca (m), vazio = padrão de ${defaultRadius} m`}>
            <input className="input num" type="number" min={10} max={5000} value={form.geofenceRadius} onChange={(e) => set({ geofenceRadius: e.target.value })} />
          </Field>
          <Field label="Vendedor responsável">
            <select className="input" value={form.sellerId} onChange={(e) => set({ sellerId: e.target.value })}>
              <option value="">Sem vendedor</option>
              {lookups.data?.vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="check full">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            Cliente ativo (inativos saem dos roteiros dos próximos dias)
          </label>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ height: 360, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--rule)' }}>
            <MapContainer center={hasPoint ? [lat, lng] : [-12.97, -38.48]} zoom={hasPoint ? 16 : 12} style={{ height: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <PickLocation onPick={(la, ln) => set({ latitude: la.toFixed(6), longitude: ln.toFixed(6) })} />
              {hasPoint && (
                <>
                  <Recenter lat={lat} lng={lng} />
                  <Circle center={[lat, lng]} radius={form.geofenceRadius ? Number(form.geofenceRadius) : defaultRadius} pathOptions={{ color: '#14213d', weight: 1, fillColor: '#f5c518', fillOpacity: 0.25 }} />
                  <Marker
                    position={[lat, lng]}
                    draggable
                    icon={L.divIcon({ className: '', html: '<div class="pin PENDENTE" style="background:#14213d">●</div>', iconSize: [26, 26], iconAnchor: [13, 13] })}
                    eventHandlers={{ dragend: (e) => set({ latitude: e.target.getLatLng().lat.toFixed(6), longitude: e.target.getLatLng().lng.toFixed(6) }) }}
                  />
                </>
              )}
            </MapContainer>
          </div>
          <span className="muted small">Clique no mapa ou arraste o marcador até a porta da loja. A área amarela é a cerca eletrônica do check-in.</span>
        </div>
      </div>
      <ErrorBox error={save.error} />
      {client && <ClientMix clientId={client.id} />}
    </Modal>
  )
}

/** Mix do cliente: produtos que ele compra. Base do contraste de ruptura no atendimento. */
function ClientMix({ clientId }: { clientId: string }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['client-mix', clientId], queryFn: () => api<(ProductRef & { active: boolean })[]>(`/admin/clients/${clientId}/mix`) })
  const save = useMutation({
    mutationFn: (productIds: string[]) => api(`/admin/clients/${clientId}/mix`, { method: 'PUT', body: { productIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-mix', clientId] }),
  })
  const mix = query.data ?? []
  const ids = mix.map((p) => p.id)
  return (
    <section className="stack" style={{ gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
      <div>
        <h3>Mix do cliente ({mix.length} produtos)</h3>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Produtos que este cliente compra. Os que não aparecerem nas fotos de depois serão confirmados pelo promotor como ruptura. Também dá para importar o mix de todos os clientes em Produtos e mix.
        </p>
      </div>
      <ProductPicker exclude={ids} onPick={(p) => save.mutate([...ids, p.id])} />
      {query.isLoading && <Loading />}
      <div className="btn-row" style={{ gap: 6 }}>
        {mix.map((p) => (
          <span key={p.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 4px 3px 8px', opacity: p.active ? 1 : 0.6 }}>
            {p.code} · {p.name}
            <button className="btn icon small" style={{ width: 22, minHeight: 22 }} aria-label={`Tirar ${p.name} do mix`} onClick={() => save.mutate(ids.filter((id) => id !== p.id))}>
              ✕
            </button>
          </span>
        ))}
        {query.data && mix.length === 0 && <span className="muted small">Nenhum produto no mix: o promotor não terá rupturas a confirmar neste cliente.</span>}
      </div>
      <ErrorBox error={save.error} />
    </section>
  )
}

const IMPORT_COLUMNS = ['codigo', 'nome', 'fantasia', 'cnpj', 'endereco', 'cidade', 'uf', 'latitude', 'longitude', 'raio', 'vendedor_login']

function ImportClients({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null)

  const onFile = async (file: File) => {
    setParseError(null)
    setResult(null)
    const table = parseCsv(await file.text())
    const header = (table[0] ?? []).map((h) =>
      h
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, ''),
    )
    const missing = ['codigo', 'nome', 'latitude', 'longitude'].filter((c) => !header.includes(c))
    if (missing.length) {
      setParseError(`Faltam colunas obrigatórias: ${missing.join(', ')}.`)
      setRows([])
      return
    }
    setRows(table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))))
  }

  const toNumber = (v: string) => Number(v.replace(',', '.'))
  const invalid = rows.filter((r) => !r.codigo || !r.nome || !Number.isFinite(toNumber(r.latitude ?? '')) || !Number.isFinite(toNumber(r.longitude ?? '')))

  const run = useMutation({
    mutationFn: () =>
      api<{ created: number; updated: number }>('/admin/clients/import', {
        method: 'POST',
        body: {
          clients: rows.map((r) => ({
            code: r.codigo,
            name: r.nome,
            tradeName: r.fantasia || null,
            document: r.cnpj || null,
            address: r.endereco || null,
            city: r.cidade || null,
            state: r.uf ? r.uf.toUpperCase().slice(0, 2) : null,
            latitude: toNumber(r.latitude!),
            longitude: toNumber(r.longitude!),
            geofenceRadius: r.raio ? Math.round(toNumber(r.raio)) : null,
            sellerLogin: r.vendedor_login || null,
          })),
        },
      }),
    onSuccess: (res) => {
      setResult(res)
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  return (
    <Modal
      title="Importar clientes de planilha"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result && (
            <button className="btn primary" disabled={rows.length === 0 || invalid.length > 0 || run.isPending} onClick={() => run.mutate()}>
              Importar {rows.length} clientes
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          Salve a planilha como CSV (separado por ponto e vírgula) com estas colunas na primeira linha. Clientes com código já cadastrado são atualizados.
        </p>
        <code className="small" style={{ background: 'var(--surface)', padding: 10, borderRadius: 4, overflowX: 'auto' }}>
          {IMPORT_COLUMNS.join(';')}
        </code>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {parseError && <div className="alert">{parseError}</div>}
        {rows.length > 0 && !result && (
          <p style={{ margin: 0 }}>
            {rows.length} linhas lidas.
            {invalid.length > 0 && <span style={{ color: 'var(--notdone)' }}> {invalid.length} sem código, nome ou coordenadas válidas: corrija a planilha antes de importar.</span>}
          </p>
        )}
        {result && (
          <div className="alert ok">
            {result.created} clientes cadastrados e {result.updated} atualizados.
          </div>
        )}
        <ErrorBox error={run.error} />
      </div>
    </Modal>
  )
}
