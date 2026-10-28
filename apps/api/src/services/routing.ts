import { env } from '../env'
import { distanceMeters } from '../lib/geo'

/**
 * Distâncias pelas ruas, calculadas por um servidor OSRM próprio (ver infra/osrm). Sem OSRM_URL, com o servidor fora
 * do ar ou num trecho sem rota, a distância cai para linha reta e vem marcada, para a tela dizer de onde ela veio.
 * O perfil é o de carro: é uma aproximação do caminho do promotor, não o trajeto exato que ele fez.
 */

export type LatLng = { latitude: number; longitude: number }
export type DistanceSource = 'ruas' | 'linha_reta'
/** De onde vieram as distâncias de um conjunto de trechos. */
export type DistanceMode = DistanceSource | 'misto'

const TIMEOUT_MS = 5_000
const CONCURRENCY = 8
/** Depois de uma falha de conexão, não tenta de novo por este tempo, para não atrasar cada relatório. */
const RETRY_AFTER_MS = 60_000
const CACHE_LIMIT = 50_000

/** Trechos já calculados. O mesmo par de clientes se repete toda semana; a chave inclui a coordenada (muda se o cliente mudar de lugar). */
const legCache = new Map<string, Promise<number | null>>()
let downUntil = 0
let running = 0
const waiting: (() => void)[] = []

/** Coordenada no formato do OSRM (longitude,latitude), arredondada em ~1 m. */
const coord = (p: LatLng) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`
const straight = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude)

export function routingEnabled() {
  return !!env.osrmUrl
}

async function osrm<T>(path: string): Promise<T | null> {
  if (!env.osrmUrl || Date.now() < downUntil) return null
  while (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    const res = await fetch(`${env.osrmUrl}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = (await res.json()) as T & { code?: string }
    // Erro de um trecho (ex.: NoRoute, NoSegment) não derruba o servidor: só esse trecho fica em linha reta
    return body.code === 'Ok' ? body : null
  } catch (e) {
    if (Date.now() >= downUntil) console.warn(`[osrm] sem resposta de ${env.osrmUrl}; distâncias em linha reta por 1 min.`, e instanceof Error ? e.message : e)
    downUntil = Date.now() + RETRY_AFTER_MS
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
