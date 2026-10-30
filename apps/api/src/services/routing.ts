import { env } from '../env'
import { distanceMeters } from '../lib/geo'

/**
 * Distâncias pelas ruas, calculadas por um servidor OSRM próprio (ver infra/osrm). Sem OSRM_URL, com o servidor fora
 * do ar ou num trecho sem rota, a distância cai para linha reta e vem marcada, para a tela dizer de onde ela veio.
 * O perfil é o de carro: é uma aproximação do caminho do promotor, não o trajeto exato que ele fez. O trajeto feito é o
 * km percorrido (GPS), com os pontos do celular encaixados nas ruas por traceDistance (services/gps-km.ts).
 */

export type LatLng = { latitude: number; longitude: number }
export type DistanceSource = 'ruas' | 'linha_reta'
/** De onde vieram as distâncias de um conjunto de trechos. */
export type DistanceMode = DistanceSource | 'misto'

const TIMEOUT_MS = 5_000
/** O encaixe de um trajeto inteiro (até 100 pontos) demora mais que uma rota. */
const MATCH_TIMEOUT_MS = 15_000
/** Pontos por pedido de encaixe (limite padrão do osrm-routed, --max-matching-size). */
const MATCH_CHUNK = 100
const CONCURRENCY = 8
/** Depois de uma falha de conexão, não tenta de novo por este tempo, para não atrasar cada relatório. */
const RETRY_AFTER_MS = 60_000
const CACHE_LIMIT = 50_000

/** Trechos já calculados. O mesmo par de clientes se repete toda semana; a chave inclui a coordenada (muda se o cliente mudar de lugar). */
const legCache = new Map<string, Promise<number | null>>()
let downUntil = 0
/** Falhas de conexão desde que a API subiu: quem grava um cálculo confere que nenhuma aconteceu no meio dele. */
let failures = 0
let running = 0
const waiting: (() => void)[] = []

/** Coordenada no formato do OSRM (longitude,latitude), arredondada em ~1 m. */
const coord = (p: LatLng) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`
const straight = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude)

export function routingEnabled() {
  return !!env.osrmUrl
}

/** Para quem grava um resultado: servidor configurado, em pausa depois de uma falha e total de falhas até agora. */
export function routingStatus() {
  return { enabled: !!env.osrmUrl, down: Date.now() < downUntil, failures }
}

async function osrm<T>(path: string, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  if (!env.osrmUrl || Date.now() < downUntil) return null
  while (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    const res = await fetch(`${env.osrmUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    const body = (await res.json()) as T & { code?: string }
    // Erro de um trecho (ex.: NoRoute, NoSegment) não derruba o servidor: só esse trecho fica em linha reta
    return body.code === 'Ok' ? body : null
  } catch (e) {
    if (Date.now() >= downUntil) console.warn(`[osrm] sem resposta de ${env.osrmUrl}; distâncias em linha reta por 1 min.`, e instanceof Error ? e.message : e)
    downUntil = Date.now() + RETRY_AFTER_MS
    failures++
    return null
  } finally {
    running--
    waiting.shift()?.()
  }
}

function roadLeg(a: LatLng, b: LatLng): Promise<number | null> {
  if (!env.osrmUrl) return Promise.resolve(null)
  if (coord(a) === coord(b)) return Promise.resolve(0)
  const key = `${coord(a)};${coord(b)}`
  const cached = legCache.get(key)
  if (cached) return cached
  const pending = osrm<{ routes: { distance: number }[] }>(`/route/v1/driving/${key}?overview=false&alternatives=false&steps=false`).then((res) => {
    const meters = res?.routes[0]?.distance ?? null
    // Só guarda o que deu certo; falha tenta de novo no próximo relatório
    if (meters == null) legCache.delete(key)
    return meters
  })
  if (legCache.size >= CACHE_LIMIT) legCache.delete(legCache.keys().next().value!)
  legCache.set(key, pending)
  return pending
}

/** Distância de cada trecho (de -> para), na ordem pedida. */
export function legDistances(legs: [LatLng, LatLng][]): Promise<{ meters: number; source: DistanceSource }[]> {
  return Promise.all(
    legs.map(async ([a, b]) => {
      const road = await roadLeg(a, b)
      return road != null ? { meters: road, source: 'ruas' as const } : { meters: straight(a, b), source: 'linha_reta' as const }
    }),
  )
}

/** Matriz de distâncias (meters[i][j] = de i até j; pelas ruas não é simétrica por causa das mãos de direção). */
export async function distanceMatrix(points: LatLng[]): Promise<{ meters: number[][]; source: DistanceMode }> {
  const road = points.length > 1 ? await osrm<{ distances: (number | null)[][] }>(`/table/v1/driving/${points.map(coord).join(';')}?annotations=distance`) : null
  let fallback = 0
  const meters = points.map((a, i) =>
    points.map((b, j) => {
      const d = road?.distances[i]?.[j]
      if (d != null) return d
      if (i !== j) fallback++
      return straight(a, b)
    }),
  )
  const pairs = points.length * (points.length - 1)
  return { meters, source: fallback === 0 && road ? 'ruas' : fallback === pairs ? 'linha_reta' : 'misto' }
}

export function combineSources(sources: DistanceSource[]): DistanceMode | null {
  if (sources.length === 0) return null
  return sources.every((s) => s === sources[0]) ? sources[0]! : 'misto'
}

/** Ponto de um trajeto de GPS: horário da posição e margem de erro informada pelo celular (m). */
export type TracePoint = LatLng & { at: Date; accuracy?: number | null }

type MatchResponse = {
  matchings: { distance: number }[]
  /** Um por ponto enviado; null quando o encaixe descartou o ponto (fora da rua, ponto repetido) */
  tracepoints: ({ matchings_index: number; location: [number, number] } | null)[]
}

/** Soma em linha reta de uma sequência de pontos. */
export function pathMeters(points: LatLng[]) {
  return points.reduce((sum, p, i) => (i > 0 ? sum + straight(points[i - 1]!, p) : 0), 0)
}

const fromLngLat = ([longitude, latitude]: [number, number]): LatLng => ({ latitude, longitude })

/** Liga dois pedaços do encaixe pela rota entre eles (sem rota, linha reta). */
async function bridge(a: LatLng, b: LatLng) {
  return (await roadLeg(a, b)) ?? straight(a, b)
}

/**
 * Metros percorridos num trajeto de GPS (pontos em ordem de horário), encaixando os pontos nas ruas (map matching do
 * OSRM). Vai em blocos de até 100 pontos, emendados no ponto em comum. Onde o encaixe se parte (salto improvável) ou
 * descarta uma ponta, os pedaços são ligados pela rota entre eles. Bloco que não encaixa (ex.: fora do mapa) vai em linha
 * reta e volta com onRoads = false. null: sem servidor de rotas, ou ele caiu (quem chamou tenta de novo depois).
 */
export async function traceDistance(points: TracePoint[]): Promise<{ meters: number; onRoads: boolean } | null> {
  if (!env.osrmUrl) return null
  let meters = 0
  let onRoads = true
  for (let first = 0; first < points.length - 1; first += MATCH_CHUNK - 1) {
    const chunk = points.slice(first, first + MATCH_CHUNK)
    const timestamps = chunk.map((p) => Math.floor(p.at.getTime() / 1000)).join(';')
    // Raio de busca = margem de erro do ponto (o OSRM procura até 3x esse raio em volta dele)
    const radiuses = chunk.map((p) => Math.round(Math.min(50, Math.max(5, p.accuracy ?? 10)))).join(';')
    const failuresBefore = failures
    const res = await osrm<MatchResponse>(
      `/match/v1/driving/${chunk.map(coord).join(';')}?timestamps=${timestamps}&radiuses=${radiuses}&gaps=ignore&tidy=true&overview=false&steps=false`,
      MATCH_TIMEOUT_MS,
    )
    const matched = res?.tracepoints.flatMap((t) => (t ? [t] : [])) ?? []
    if (!res || res.matchings.length === 0 || matched.length === 0) {
      if (failures !== failuresBefore || Date.now() < downUntil) return null
      meters += pathMeters(chunk)
      onRoads = false
      continue
    }
    meters += res.matchings.reduce((sum, m) => sum + m.distance, 0)
    for (const [i, t] of matched.entries()) {
      const prev = matched[i - 1]
      if (prev && prev.matchings_index !== t.matchings_index) meters += await bridge(fromLngLat(prev.location), fromLngLat(t.location))
    }
    if (res.tracepoints[0] == null) meters += await bridge(chunk[0]!, fromLngLat(matched[0]!.location))
    if (res.tracepoints.at(-1) == null) meters += await bridge(fromLngLat(matched.at(-1)!.location), chunk.at(-1)!)
  }
  return { meters, onRoads }
}
