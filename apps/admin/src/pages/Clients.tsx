import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { api } from '../api'
import { useAuth } from '../auth'
import { downloadCsv, fmtNumber, parseCsv, UFS } from '../format'
import type { Client, ClientCity, Paged, ProductRef, SettingsResponse } from '../types'
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, ProductPicker, Segmented } from '../ui'

const PAGE_SIZE = 50

type Located = 'todos' | 'com' | 'sem'
type Filters = { search: string; state: string; city: string; located: Located }

type Form = {
  name: string
  legalName: string
  city: string
  state: string
  latitude: string
  longitude: string
  active: boolean
}

const emptyForm: Form = { name: '', legalName: '', city: '', state: 'BA', latitude: '', longitude: '', active: true }

const toNumber = (v: string) => Number(v.trim().replace(',', '.'))
/** "-12.9714, -38.5014" (copiado do Google Maps) ou "-12,9714; -38,5014" */
const COORDS = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/
const splitCoords = (v: string) => {
  const m = COORDS.exec(v)
  return m ? { latitude: m[1]!.replace(',', '.'), longitude: m[2]!.replace(',', '.') } : null
}
const validLat = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90
const validLng = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180

/** Filtros da lista como parâmetros da API (lista e planilha). */
const filterQuery = (f: Filters) => ({
  search: f.search,
  state: f.state,
  city: f.city,
  located: f.located === 'todos' ? undefined : f.located === 'com',
})

export function ClientsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({ search: '', state: '', city: '', located: 'todos' })
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Client | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const cities = useQuery({ queryKey: ['client-cities'], queryFn: () => api<ClientCity[]>('/admin/client-cities') })
  const states = [...new Set(cities.data?.map((c) => c.state))]
  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }

  useEffect(() => {
    const t = setTimeout(() => setFilter({ search: search.trim() }), 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useQuery({
    queryKey: ['clients', filters, page],
    queryFn: () => api<Paged<Client> & { missingLocation: number }>('/admin/clients', { query: { ...filterQuery(filters), page, pageSize: PAGE_SIZE } }),
  })

  const download = useMutation({
    mutationFn: (f: Filters) => api<Client[]>('/admin/clients/export', { query: filterQuery(f) }),
    onSuccess: (clients, f) =>
      downloadCsv(
        f.located === 'sem' ? 'clientes-sem-localizacao.csv' : 'clientes.csv',
        IMPORT_COLUMNS,
        clients.map((c) => [c.id, c.legalName, c.name, c.city, c.state, c.latitude, c.longitude]),
      ),
  })

  const missing = query.data?.missingLocation ?? 0
  return (
    <div>
      <PageHead
        title="Clientes"
        description="Pontos de venda atendidos pelos promotores. A localização define a cerca eletrônica do check-in: cliente sem latitude e longitude não entra em roteiro."
        actions={
          <>
            <button className="btn" disabled={download.isPending} onClick={() => download.mutate(filters)}>
              Baixar planilha
            </button>
            {isAdmin && (
              <button className="btn" onClick={() => setImporting(true)}>
                Importar planilha
              </button>
            )}
            <button className="btn primary" onClick={() => setEditing('new')}>
              Novo cliente
            </button>
          </>
        }
      />
      {missing > 0 && filters.located !== 'sem' && (
        <div className="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ flex: '1 1 320px' }}>
            {missing === 1 ? '1 cliente está' : `${fmtNumber(missing)} clientes estão`} sem localização e não {missing === 1 ? 'pode' : 'podem'} entrar em roteiro. Baixe a
            planilha deles, preencha a latitude e a longitude e importe de volta.
          </span>
          <button className="btn small" onClick={() => setFilter({ located: 'sem' })}>
            Ver só eles
          </button>
          <button className="btn small" disabled={download.isPending} onClick={() => download.mutate({ search: '', state: '', city: '', located: 'sem' })}>
            Baixar planilha deles
          </button>
        </div>
      )}
      <div className="toolbar">
        <Field label="Buscar">
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome fantasia, razão social ou cidade" style={{ minWidth: 260 }} />
        </Field>
        <Field label="UF">
          <select className="input" value={filters.state} onChange={(e) => setFilter({ state: e.target.value, city: '' })}>
            <option value="">Todas</option>
            {states.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cidade">
          <select className="input" value={filters.city} disabled={!filters.state} onChange={(e) => setFilter({ city: e.target.value })}>
            <option value="">{filters.state ? 'Todas' : 'Escolha a UF'}</option>
            {cities.data
              ?.filter((c) => c.state === filters.state)
              .map((c) => (
                <option key={c.city} value={c.city}>
                  {c.city} ({c.clients})
                </option>
              ))}
          </select>
        </Field>
        <Field label="Localização">
          <Segmented<Located>
            value={filters.located}
            onChange={(located) => setFilter({ located })}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'com', label: 'Com' },
              { value: 'sem', label: 'Sem' },
            ]}
          />
        </Field>
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error ?? download.error} />
      {query.data && query.data.items.length === 0 && <Empty>Nenhum cliente encontrado.</Empty>}
      {query.data && query.data.items.length > 0 && (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nome fantasia / razão social</th>
                <th>Cidade</th>
                <th>Localização</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.legalName && c.legalName !== c.name && <div className="small muted">{c.legalName}</div>}
                  </td>
                  <td>{[c.city, c.state].filter(Boolean).join(' - ') || <span className="muted">—</span>}</td>
                  <td className="num">
                    {c.latitude != null && c.longitude != null ? (
                      `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`
                    ) : (
                      <span style={{ color: 'var(--notdone)' }}>Sem localização</span>
                    )}
                  </td>
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

/** Centraliza o mapa quando muda o alvo (ponto do cliente ou, sem ele, a cidade). */
function Recenter({ lat, lng, zoom, target }: { lat: number; lng: number; zoom: number; target: string }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), zoom))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  return null
}

function ClientForm({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/admin/settings') })
  const cities = useQuery({ queryKey: ['client-cities'], queryFn: () => api<ClientCity[]>('/admin/client-cities') })
  const radius = Number(settings.data?.values.geofenceRadiusMeters ?? 150)
  const [form, setForm] = useState<Form>(() =>
    client
      ? {
          name: client.name,
          legalName: client.legalName ?? '',
          city: client.city ?? '',
          state: client.state ?? 'BA',
          latitude: client.latitude != null ? String(client.latitude) : '',
          longitude: client.longitude != null ? String(client.longitude) : '',
          active: client.active,
        }
      : emptyForm,
  )
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  /** Colar "lat, lng" em qualquer um dos dois campos preenche os dois. */
  const setCoord = (field: 'latitude' | 'longitude', value: string) => set(splitCoords(value) ?? { [field]: value })
  const lat = toNumber(form.latitude)
  const lng = toNumber(form.longitude)
  const hasPoint = form.latitude !== '' && form.longitude !== '' && validLat(lat) && validLng(lng)
  const halfPoint = (form.latitude === '') !== (form.longitude === '') || ((form.latitude !== '' || form.longitude !== '') && !hasPoint)
  // Sem localização, o mapa abre num cliente da mesma cidade
  const neighbor = useQuery({
    queryKey: ['client-near', form.state, form.city.trim()],
    queryFn: () => api<Paged<Client>>('/admin/clients', { query: { state: form.state, city: form.city.trim(), located: true, pageSize: 1 } }),
    enabled: !hasPoint && form.city.trim().length >= 2,
  })
  const near = neighbor.data?.items[0]
  const center: [number, number] = hasPoint ? [lat, lng] : near ? [near.latitude!, near.longitude!] : [-12.97, -38.48]

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        legalName: form.legalName || null,
        city: form.city,
        state: form.state,
        ...(hasPoint ? { latitude: lat, longitude: lng } : {}),
        active: form.active,
      }
      return client ? api(`/admin/clients/${client.id}`, { method: 'PATCH', body }) : api('/admin/clients', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client-cities'] })
      onClose()
    },
  })

  // Quem já tem localização não volta a ficar sem (os roteiros dependem dela)
  const removingPoint = client?.latitude != null && !hasPoint
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
          <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || form.name.trim().length < 2 || form.city.trim().length < 2 || halfPoint || removingPoint}>
            {client ? 'Salvar cliente' : 'Cadastrar cliente'}
          </button>
        </>
      }
    >
      <div className="cols-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="form-grid" style={{ alignContent: 'start' }}>
          <Field label="Nome fantasia" className="full">
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Razão social" className="full">
            <input className="input" value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} />
          </Field>
          <Field label="Cidade">
            <input className="input" list="client-form-cities" value={form.city} onChange={(e) => set({ city: e.target.value })} />
            <datalist id="client-form-cities">
              {cities.data
                ?.filter((c) => c.state === form.state)
                .map((c) => (
                  <option key={c.city} value={c.city} />
                ))}
            </datalist>
          </Field>
          <Field label="UF">
            <select className="input" value={form.state} onChange={(e) => set({ state: e.target.value })}>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Latitude">
            <input className="input" style={{ fontVariantNumeric: 'tabular-nums' }} value={form.latitude} onChange={(e) => setCoord('latitude', e.target.value)} placeholder="-12.9714" />
          </Field>
          <Field label="Longitude">
            <input className="input" style={{ fontVariantNumeric: 'tabular-nums' }} value={form.longitude} onChange={(e) => setCoord('longitude', e.target.value)} placeholder="-38.5014" />
          </Field>
          <span className="small muted full">
            Dá para colar as coordenadas copiadas do Google Maps (ex.: “-12.9714, -38.5014”) em qualquer um dos dois campos.
            {!hasPoint && !halfPoint && ' Sem localização, o cliente fica cadastrado mas não entra em roteiro.'}
          </span>
          {halfPoint && <span className="small full" style={{ color: 'var(--notdone)' }}>Preencha latitude e longitude válidas (as duas).</span>}
          {removingPoint && <span className="small full" style={{ color: 'var(--notdone)' }}>A localização não pode ser apagada: corrija os números ou marque no mapa.</span>}
          <label className="check full">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            Cliente ativo (inativos saem dos roteiros dos próximos dias)
          </label>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ height: 360, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--rule)' }}>
            <MapContainer center={center} zoom={hasPoint ? 16 : 12} style={{ height: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <PickLocation onPick={(la, ln) => set({ latitude: la.toFixed(6), longitude: ln.toFixed(6) })} />
              <Recenter lat={center[0]} lng={center[1]} zoom={hasPoint ? 15 : 12} target={hasPoint ? 'ponto' : (near?.id ?? 'padrao')} />
              {hasPoint && (
                <>
                  <Circle center={[lat, lng]} radius={radius} pathOptions={{ color: '#14213d', weight: 1, fillColor: '#f5c518', fillOpacity: 0.25 }} />
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
          <span className="muted small">Clique no mapa ou arraste o marcador até a porta da loja. A área amarela é a cerca eletrônica do check-in ({radius} m, em Regras).</span>
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

const IMPORT_COLUMNS = ['id', 'razao_social', 'nome_fantasia', 'cidade', 'uf', 'latitude', 'longitude']

/** Cabeçalho sem acento, minúsculo e com _ ("Razão Social" = razao_social); aceita nomes alternativos. */
const HEADER_ALIASES: Record<string, string> = { fantasia: 'nome_fantasia', nome: 'nome_fantasia', estado: 'uf', lat: 'latitude', lng: 'longitude', lon: 'longitude' }
const headerKey = (h: string) => {
  const k = h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return HEADER_ALIASES[k] ?? k
}

type ImportRow = {
  line: number
  id: string | null
  name: string | null
  legalName: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
}
type ImportResult = { created: number; updated: number; located: number; problems: { line: number; message: string }[] }

/** Converte e confere as linhas da planilha; as com problema ficam de fora, com o motivo. */
function readRows(table: string[][]) {
  const header = (table[0] ?? []).map(headerKey)
  const rows: ImportRow[] = []
  const problems: { line: number; message: string }[] = []
  for (const [i, cells] of table.slice(1).entries()) {
    const line = i + 2
    const r = Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()]))
    const both = r.coordenadas ? splitCoords(r.coordenadas) : null
    if (r.coordenadas && !both) {
      problems.push({ line, message: `coordenadas "${r.coordenadas}" não reconhecidas (use "latitude, longitude")` })
      continue
    }
    const latText = both?.latitude ?? r.latitude ?? ''
    const lngText = both?.longitude ?? r.longitude ?? ''
    const latitude = latText ? toNumber(latText) : null
    const longitude = lngText ? toNumber(lngText) : null
    const state = r.uf ? r.uf.toUpperCase() : null
    const name = r.nome_fantasia || null
    const legalName = r.razao_social || null
    const message =
      (latitude == null) !== (longitude == null)
        ? 'latitude e longitude precisam vir juntas'
        : latitude != null && (!validLat(latitude) || !validLng(longitude!))
          ? `latitude/longitude inválidas (${latText}; ${lngText})`
          : state && !UFS.includes(state)
            ? `UF "${r.uf}" inválida`
            : !r.id && (!(name || legalName) || !r.cidade || !state)
              ? 'sem id, informe o nome fantasia (ou a razão social), a cidade e a UF'
              : null
    if (message) problems.push({ line, message })
    else rows.push({ line, id: r.id || null, name, legalName, city: r.cidade || null, state, latitude, longitude })
  }
  const missing = header.includes('id') || ['cidade', 'uf'].every((c) => header.includes(c)) ? null : 'a planilha precisa da coluna id ou das colunas cidade e uf'
  return { rows, problems, missing }
}

function ImportClients({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [read, setRead] = useState<ReturnType<typeof readRows> | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const onFile = async (file: File) => {
    setResult(null)
    setRead(readRows(parseCsv(await file.text())))
  }

  const run = useMutation({
    mutationFn: () => api<ImportResult>('/admin/clients/import', { method: 'POST', body: { clients: read!.rows } }),
    onSuccess: (res) => {
      setResult(res)
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client-cities'] })
    },
  })

  const problems = [...(read?.problems ?? []), ...(result?.problems ?? [])].sort((a, b) => a.line - b.line)
  const withCoords = read?.rows.filter((r) => r.latitude != null).length ?? 0
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
            <button className="btn primary" disabled={!read || read.rows.length === 0 || !!read.missing || run.isPending} onClick={() => run.mutate()}>
              Importar {read?.rows.length ?? 0} linhas
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          Para preencher a localização: use <strong>Baixar planilha</strong> (ou “Baixar planilha deles”, só os sem localização), preencha a latitude e a longitude e importe o arquivo de
          volta, salvo como CSV separado por ponto e vírgula. As colunas são:
        </p>
        <code className="small" style={{ background: 'var(--surface)', padding: 10, borderRadius: 4, overflowX: 'auto' }}>
          {IMPORT_COLUMNS.join(';')}
        </code>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Linha com id altera aquele cliente. Sem id, o cliente é procurado pelo nome fantasia (ou razão social) na mesma cidade e UF; se não existir, é cadastrado.</li>
          <li>Latitude e longitude vazias mantêm a localização atual. No lugar delas, aceita uma coluna “coordenadas” com o texto copiado do Google Maps.</li>
          <li>Números com vírgula ou ponto (-12,9714 ou -12.9714).</li>
        </ul>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {read?.missing && <div className="alert">Não dá para importar: {read.missing}.</div>}
        {read && !read.missing && !result && (
          <p style={{ margin: 0 }}>
            {read.rows.length} linhas prontas, {withCoords} com localização.
            {read.problems.length > 0 && <span style={{ color: 'var(--notdone)' }}> {read.problems.length} com problema ficam de fora (lista abaixo).</span>}
          </p>
        )}
        {result && (
          <div className="alert ok">
            {result.created} clientes cadastrados e {result.updated} atualizados; {result.located} com localização preenchida.
          </div>
        )}
        {problems.length > 0 && (
          <div className="small" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 4, padding: '6px 10px' }}>
            {problems.map((p) => (
              <div key={`${p.line}-${p.message}`}>
                <strong>Linha {p.line}:</strong> {p.message}
              </div>
            ))}
          </div>
        )}
        <ErrorBox error={run.error} />
      </div>
    </Modal>
  )
}
