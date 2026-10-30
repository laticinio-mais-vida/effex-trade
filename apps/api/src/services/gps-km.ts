import { prisma } from '../db'
import { todayIn, toDbDate } from '../lib/dates'
import { distanceMeters } from '../lib/geo'
import { travelLegs } from './reports'
import { legDistances, pathMeters, routingStatus, traceDistance, type LatLng, type TracePoint } from './routing'
import { getSettings } from './settings'

/**
 * Km percorrido (GPS): em cada trecho entre lojas (da saída de um atendimento até a abertura do seguinte, a mesma regra
 * do relatório), soma o caminho que o celular registrou, com os pontos encaixados nas ruas pelo servidor de rotas.
 * É calculado uma vez, alguns minutos depois que o dia é encerrado, e gravado na abertura que fecha o trecho
 * (VisitSession.gpsMeters): o relatório só lê, abre rápido e o número não muda depois.
 *
 * Antes do encaixe saem os pontos de GPS falso, os imprecisos, o ponto que vai e volta rápido demais (salto do GPS) e os
 * "pulos" com o promotor parado. Onde faltam pontos (mais de dois intervalos de envio sem nenhum: sem sinal, celular
 * desligado ou sem permissão), aquele pedaço é a rota estimada e fica somado à parte, em gpsEstimatedMeters.
 */

/** Posição com margem de erro maior que esta não entra (GPS fraco, posição pela antena). */
const MAX_ACCURACY_M = 100
/** Parado, o GPS oscila em volta do mesmo lugar: ponto mais perto do anterior que isto (ou que a própria margem de erro) não entra no encaixe. */
const STILL_M = 50
/** 180 km/h: ponto que chega e sai acima disto é salto do GPS. */
const MAX_SPEED_MS = 50
/** Folga depois do encerramento, para chegarem as posições que ficaram guardadas no celular. */
const SETTLE_MS = 5 * 60_000
/** Dia que deu erro inesperado só é tentado de novo depois disto. */
const RETRY_FAILED_MS = 60 * 60_000

const point = (latitude: number | null | undefined, longitude: number | null | undefined): LatLng | null =>
  latitude != null && longitude != null ? { latitude, longitude } : null
const meters = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude)
const seconds = (p: TracePoint) => Math.floor(p.at.getTime() / 1000)
const speed = (a: TracePoint, b: TracePoint) => meters(a, b) / Math.max(1, seconds(b) - seconds(a))

/**
 * Um ponto por segundo (o servidor de rotas exige horários crescentes). A saída e a chegada ficam sempre: a chegada
 * toma o lugar do ponto do mesmo segundo, ou fica um segundo depois da saída se o trecho inteiro coube num segundo.
 */
function oncePerSecond(points: TracePoint[]) {
  const out: TracePoint[] = []
  for (const [i, p] of points.entries()) {
    const last = out.at(-1)
    if (last && seconds(p) <= seconds(last)) {
      if (i < points.length - 1) continue
      if (out.length > 1) out[out.length - 1] = p
      else out.push({ ...p, at: new Date((seconds(last) + 1) * 1000) })
      continue
    }
    out.push(p)
  }
  return out
}

/** Tira o ponto que chega e sai rápido demais (vai e volta: salto do GPS). A saída e a chegada ficam sempre. */
function withoutSpikes(points: TracePoint[]) {
  const out: TracePoint[] = []
  for (const [i, p] of points.entries()) {
    const prev = out.at(-1)
    const next = points[i + 1]
    if (prev && next && speed(prev, p) > MAX_SPEED_MS && speed(p, next) > MAX_SPEED_MS) continue
    out.push(p)
  }
  return out
}

/** Tira os pulos com o promotor parado: só entra o ponto que se afastou do último mais que a margem. As pontas ficam. */
function withoutStops(points: TracePoint[]) {
  const out: TracePoint[] = []
  for (const [i, p] of points.entries()) {
    const last = out.at(-1)
    if (last && i < points.length - 1 && meters(last, p) < Math.max(STILL_M, p.accuracy ?? 0)) continue
    out.push(p)
  }
  return out
}

/**
 * Metros de um trecho: os pedaços com pontos vão encaixados nas ruas (sem servidor de rotas, em linha reta); as lacunas,
 * pela rota estimada entre o último ponto antes e o primeiro depois (somadas também em estimated). null: o servidor de
 * rotas caiu no meio.
 */
async function legMeters(track: TracePoint[], gapMs: number, withRoutes: boolean) {
  const runs: TracePoint[][] = [[track[0]!]]
  let estimated = 0
  for (const [i, p] of track.entries()) {
    const prev = track[i - 1]
    if (!prev) continue
    if (p.at.getTime() - prev.at.getTime() > gapMs) {
      estimated += (await legDistances([[prev, p]]))[0]!.meters
      runs.push([p])
    } else {
      runs.at(-1)!.push(p)
    }
  }
  let traced = 0
  let onRoads = true
  for (const run of runs) {
    const kept = withoutStops(run)
    if (kept.length < 2) continue
    if (!withRoutes) {
      traced += pathMeters(kept)
      continue
    }
    const matched = await traceDistance(kept)
    if (!matched) return null
    traced += matched.meters
    onRoads &&= matched.onRoads
  }
  return { meters: traced + estimated, estimated, onRoads }
}

/**
 * Calcula e grava o km percorrido de uma jornada. 'adiado': o servidor de rotas está fora do ar (ou caiu no meio da
 * conta), e o dia fica para a próxima rodada. Sem servidor configurado, a conta é em linha reta, mas só fora de produção
 * (no computador, para testar): em produção o dia espera o servidor, para o número gravado não sair pior do que deveria.
 */
export async function computeDayGpsKm(workDayId: string): Promise<'gravado' | 'adiado' | 'calculado_antes'> {
  const status = routingStatus()
  if (status.enabled ? status.down : process.env.NODE_ENV === 'production') return 'adiado'

  const day = await prisma.workDay.findUniqueOrThrow({
    where: { id: workDayId },
    include: {
      visits: {
        where: { status: { not: 'CANCELADA' } },
        orderBy: { position: 'asc' },
        include: { client: { select: { latitude: true, longitude: true } }, sessions: { orderBy: { checkinAt: 'asc' } } },
      },
    },
  })
  if (day.gpsKmAt) return 'calculado_antes'
  const legs = travelLegs(day.visits.flatMap((v) => v.sessions.map((s) => ({ ...s, client: v.client }))))

  const results: { sessionId: string; meters: number; estimated: number }[] = []
  let onRoads = true
  if (legs.length > 0) {
    const { trackingIntervalMinutes } = await getSettings(day.promotorId)
    const gapMs = (2 * trackingIntervalMinutes + 1) * 60_000
    const pings = await prisma.locationPing.findMany({
      where: { promotorId: day.promotorId, mocked: false, recordedAt: { gt: legs[0]!.start, lt: legs.at(-1)!.to.checkinAt } },
      orderBy: { recordedAt: 'asc' },
      select: { latitude: true, longitude: true, accuracy: true, recordedAt: true },
    })
    const usable = pings.filter((p) => p.accuracy == null || p.accuracy <= MAX_ACCURACY_M)

    for (const { from, to, start } of legs) {
      // Saída: onde foi o check-out (ou o check-in, se a abertura ficou sem saída); chegada: onde foi o check-in
      const exit = point(from.checkoutLat, from.checkoutLng) ?? point(from.checkinLat, from.checkinLng) ?? point(from.client.latitude, from.client.longitude)
      const arrival = point(to.checkinLat, to.checkinLng) ?? point(to.client.latitude, to.client.longitude)
      const inside: TracePoint[] = usable
        .filter((p) => p.recordedAt > start && p.recordedAt < to.checkinAt)
        .map((p) => ({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, at: p.recordedAt }))
      const track = withoutSpikes(oncePerSecond([...(exit ? [{ ...exit, at: start }] : []), ...inside, ...(arrival ? [{ ...arrival, at: to.checkinAt }] : [])]))
      if (track.length < 2) continue
      const leg = await legMeters(track, gapMs, status.enabled)
      if (!leg) return 'adiado'
      onRoads &&= leg.onRoads
      results.push({ sessionId: to.id, meters: leg.meters, estimated: leg.estimated })
    }
  }

  // O servidor de rotas caiu no meio da conta: pedaços teriam saído em linha reta sem aviso. Não grava, tenta depois.
  if (routingStatus().failures !== status.failures) return 'adiado'
  const mode = results.length === 0 ? null : !status.enabled ? 'linha_reta' : onRoads ? 'ruas' : 'misto'
  const saved = await prisma.$transaction(async (tx) => {
    // Só grava quem pegou o dia ainda sem cálculo (duas contas ao mesmo tempo não se sobrepõem)
    const { count } = await tx.workDay.updateMany({ where: { id: day.id, gpsKmAt: null }, data: { gpsKmAt: new Date(), gpsKmMode: mode } })
    if (count === 0) return false
    for (const r of results) await tx.visitSession.update({ where: { id: r.sessionId }, data: { gpsMeters: r.meters, gpsEstimatedMeters: r.estimated } })
    return true
  })
  return saved ? 'gravado' : 'calculado_antes'
}

let running = false
const failedAt = new Map<string, number>()

/**
 * Calcula as jornadas que ainda não têm o km percorrido: encerradas há pelo menos 5 min, ou de datas passadas que
 * ficaram abertas (o promotor esqueceu de encerrar). Roda a cada 5 min (server.ts), um dia por vez; para na primeira
 * jornada adiada (servidor de rotas fora do ar). Retorna quantas jornadas gravou.
 */
export async function computePendingGpsKm(now = new Date()) {
  if (running) return 0
  running = true
  let saved = 0
  try {
    const days = await prisma.workDay.findMany({
      where: {
        gpsKmAt: null,
        startedAt: { not: null },
        OR: [{ closedAt: { lte: new Date(now.getTime() - SETTLE_MS) } }, { date: { lt: toDbDate(todayIn(undefined, now)) } }],
      },
      select: { id: true },
      orderBy: { date: 'asc' },
    })
    for (const { id } of days) {
      if (now.getTime() - (failedAt.get(id) ?? 0) < RETRY_FAILED_MS) continue
      try {
        const result = await computeDayGpsKm(id)
        if (result === 'adiado') break
        if (result === 'gravado') saved++
      } catch (error) {
        failedAt.set(id, now.getTime())
        console.warn(`[km-gps] não foi possível calcular a jornada ${id}:`, error instanceof Error ? error.message : error)
      }
    }
  } finally {
    running = false
  }
  return saved
}
