type Point = { latitude: number; longitude: number }
/** Distância em metros de a até b (pelas ruas, vinda da API, ou em linha reta). */
export type Distance<T> = (a: T, b: T) => number

const EARTH_RADIUS_M = 6_371_000
const EPS = 1e-6
/** Até este tamanho a ordem é calculada de forma exata; acima, por heurística (vizinho mais próximo + 2-opt + or-opt). */
const EXACT_LIMIT = 15
/** Partidas testadas pela heurística: com muitos clientes, uma amostra espalhada basta e mantém a resposta instantânea. */
const MAX_STARTS = 40

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function distanceMeters(a: Point, b: Point) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Deslocamento total, em metros, percorrendo os pontos na ordem dada. */
export function pathMeters<T extends Point>(points: T[], dist: Distance<T> = distanceMeters) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!)
  return total
}

/**
 * Ordem de atendimento com o menor deslocamento. O roteiro começa no primeiro check-in, então o caminho é aberto
 * (não volta ao início) e pode começar por qualquer cliente; entre os dois sentidos do caminho, fica o que começa mais
 * perto do primeiro cliente da ordem atual. Pelas ruas, ida e volta diferem um pouco (mão de direção); a busca usa a
 * média das duas, o que basta para uma sugestão.
 */
export function suggestOrder<T extends Point>(items: T[], dist: Distance<T> = distanceMeters): T[] {
  const n = items.length
  if (n < 3) return [...items]
  const d = items.map((a) => items.map((b) => (dist(a, b) + dist(b, a)) / 2))
  const order = n <= EXACT_LIMIT ? exactPath(d) : heuristicPath(d)
  if (d[order[order.length - 1]!]![0]! < d[order[0]!]![0]!) order.reverse()
  return order.map((i) => items[i]!)
}

function length(path: number[], d: number[][]) {
  let total = 0
  for (let i = 1; i < path.length; i++) total += d[path[i - 1]!]![path[i]!]!
  return total
}

/** Programação dinâmica de Held-Karp para o caminho aberto mais curto. */
function exactPath(d: number[][]) {
  const n = d.length
  const full = 1 << n
  const cost = new Float64Array(full * n).fill(Infinity)
  const from = new Int8Array(full * n).fill(-1)
  for (let j = 0; j < n; j++) cost[(1 << j) * n + j] = 0
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < n; j++) {
      const c = cost[mask * n + j]!
      if (c === Infinity) continue
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue
        const at = (mask | (1 << k)) * n + k
        const v = c + d[j]![k]!
        if (v < cost[at]!) {
          cost[at] = v
          from[at] = j
        }
      }
    }
  }
  const last = (full - 1) * n
  let end = 0
  for (let j = 1; j < n; j++) if (cost[last + j]! < cost[last + end]!) end = j
  const path: number[] = []
  for (let mask = full - 1, j = end; j !== -1; ) {
    path.push(j)
    const prev = from[mask * n + j]!
    mask &= ~(1 << j)
    j = prev
  }
  return path.reverse()
}

/** Parte da ordem atual e de vários vizinhos mais próximos; como a melhoria só encurta, nunca sai pior que a ordem atual. */
function heuristicPath(d: number[][]) {
  const n = d.length
  const starts = Math.min(n, MAX_STARTS)
  const current = Array.from({ length: n }, (_, i) => i)
  let best = improve(current, d)
  let bestLen = length(best, d)
  for (let s = 0; s < starts; s++) {
    const path = improve(nearestNeighbor(d, Math.floor((s * n) / starts)), d)
    const len = length(path, d)
    if (len < bestLen - EPS) {
      best = path
      bestLen = len
    }
  }
  return best
}

function nearestNeighbor(d: number[][], start: number) {
  const n = d.length
  const used = new Array<boolean>(n).fill(false)
  const path = [start]
  used[start] = true
  while (path.length < n) {
    const row = d[path[path.length - 1]!]!
    let next = -1
    for (let k = 0; k < n; k++) if (!used[k] && (next === -1 || row[k]! < row[next]!)) next = k
    path.push(next)
    used[next] = true
  }
  return path
}

/** Melhora o caminho até não haver ganho: 2-opt (inverte um trecho) e or-opt (muda de lugar um trecho de 1 a 3 clientes). */
function improve(start: number[], d: number[][]) {
  let path = start
  const n = path.length
  const dist = (a: number, b: number) => (a < 0 || b < 0 ? 0 : d[a]![b]!)
  for (let improved = true; improved; ) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const before = i > 0 ? path[i - 1]! : -1
        const after = j < n - 1 ? path[j + 1]! : -1
        const gain = dist(before, path[i]!) + dist(path[j]!, after) - dist(before, path[j]!) - dist(path[i]!, after)
        if (gain > EPS) {
          path = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)]
          improved = true
        }
      }
    }
    for (let len = 1; len <= 3 && len < n; len++) {
      for (let i = 0; i + len <= n; i++) {
        const seg = path.slice(i, i + len)
        const rest = [...path.slice(0, i), ...path.slice(i + len)]
        const head = seg[0]!
        const tail = seg[len - 1]!
        const before = i > 0 ? path[i - 1]! : -1
        const after = i + len < n ? path[i + len]! : -1
        const removed = dist(before, head) + dist(tail, after) - dist(before, after)
        let bestGain = EPS
        let bestAt = -1
        let reversed = false
        for (let k = 0; k <= rest.length; k++) {
          const x = k > 0 ? rest[k - 1]! : -1
          const y = k < rest.length ? rest[k]! : -1
          const base = dist(x, y)
          const forward = removed - (dist(x, head) + dist(tail, y) - base)
          const backward = removed - (dist(x, tail) + dist(head, y) - base)
          if (forward > bestGain) [bestGain, bestAt, reversed] = [forward, k, false]
          if (backward > bestGain) [bestGain, bestAt, reversed] = [backward, k, true]
        }
        if (bestAt >= 0) {
          path = [...rest.slice(0, bestAt), ...(reversed ? seg.reverse() : seg), ...rest.slice(bestAt)]
          improved = true
        }
      }
    }
  }
  return path
}
