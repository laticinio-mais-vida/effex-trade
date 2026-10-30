import { prisma, Prisma } from '../db'
import { fromDbDate, minutesBetween, toDbDate } from '../lib/dates'
import { combineSources, legDistances, type DistanceMode, type DistanceSource, type LatLng } from './routing'

const reportInclude = {
  client: true,
  promotor: { select: { id: true, name: true } },
  justificationReason: true,
  workDay: { include: { alerts: { where: { type: 'ALMOCO_LONGO' }, select: { id: true } } } },
  _count: { select: { photos: true } },
  requests: { where: { status: 'APROVADA' }, select: { type: true } },
  ruptures: { include: { product: { select: { id: true, code: true, name: true } } } },
  sessions: { orderBy: { checkinAt: 'asc' } },
} satisfies Prisma.VisitInclude

type ReportVisit = Prisma.VisitGetPayload<{ include: typeof reportInclude }>

const round = (n: number) => Math.round(n * 10) / 10
/** Ponto do cliente; sem localização, o trecho fica sem quilometragem. */
const pointOf = (c: { latitude: number | null; longitude: number | null }): LatLng | null =>
  c.latitude != null && c.longitude != null ? { latitude: c.latitude, longitude: c.longitude } : null

/** Quanto do km percorrido veio do rastro de GPS: tudo, parte (o resto é rota estimada) ou nada. */
export type GpsCoverage = 'completo' | 'parcial' | 'estimado'

function coverage(total: number | null | undefined, estimated: number | null | undefined): GpsCoverage | null {
  if (total == null) return null
  if (!estimated) return 'completo'
  return estimated >= total ? 'estimado' : 'parcial'
}

/**
 * Trechos de deslocamento de um dia: as aberturas de atendimento em ordem de check-in; há trecho da saída de uma
 * (check-out, ou o check-in se ficou aberta) até o check-in da seguinte, quando as duas não se sobrepõem. O relatório e o
 * km percorrido (services/gps-km.ts) usam esta mesma regra.
 */
export function travelLegs<S extends { checkinAt: Date; checkoutAt: Date | null }>(sessions: S[]) {
  const sorted = [...sessions].sort((a, b) => a.checkinAt.getTime() - b.checkinAt.getTime())
  const legs: { from: S; to: S; start: Date }[] = []
  for (const [i, to] of sorted.entries()) {
    const from = sorted[i - 1]
    if (!from) continue
    const start = from.checkoutAt ?? from.checkinAt
    if (start <= to.checkinAt) legs.push({ from, to, start })
  }
  return legs
}

/**
 * Relatório de execução: tempo em cada cliente, deslocamento entre clientes
 * (check-out do anterior até o check-in do seguinte; como o roteiro começa no primeiro check-in,
 * o primeiro cliente do dia não tem deslocamento) e justificativas de não atendimento.
 * Atendimento encerrado automaticamente tem saída na última foto, então o deslocamento seguinte
 * conta dessa foto até a próxima abertura. Os km pela rota são pelas ruas quando há servidor de rotas (OSRM);
 * travelKmSource diz se vieram das ruas, em linha reta ou misturados. O km percorrido (GPS) é o gravado em cada
 * abertura depois que o dia é encerrado (services/gps-km.ts); gpsKmSource diz como os pontos foram ligados.
 */
export async function visitReport(filter: { from: string; to: string; promotorIds?: string[] }) {
  const visits = await prisma.visit.findMany({
    where: {
      date: { gte: toDbDate(filter.from), lte: toDbDate(filter.to) },
      status: { not: 'CANCELADA' },
      ...(filter.promotorIds ? { promotorId: { in: filter.promotorIds } } : {}),
    },
    include: reportInclude,
    orderBy: [{ date: 'asc' }, { promotorId: 'asc' }, { position: 'asc' }],
  })

  const groups = new Map<string, ReportVisit[]>()
  for (const v of visits) {
    const key = `${v.promotorId}|${fromDbDate(v.date)}`
    groups.set(key, [...(groups.get(key) ?? []), v])
  }

  const rows: ReturnType<typeof toRow>[] = []
  const days: {
    date: string
    promotor: { id: string; name: string }
    /** Ponto de início: abertura do primeiro atendimento */
    workStart: Date | null
    /** Ponto de fim: última atividade do dia */
    workEnd: Date | null
    /** Quando o roteiro foi encerrado (botão ou sistema) */
    closedAt: Date | null
    lunchStart: Date | null
    lunchEnd: Date | null
    lunchMin: number | null
    /** O almoço passou do limite e o supervisor foi alertado */
    lunchOverdue: boolean
    /** Supervisor liberou o dia inteiro da ordem do roteiro */
    routeOrderWaived: boolean
    /** Fim - início - almoço */
    workedMin: number | null
    total: number
    done: number
    justified: number
    notDone: number
    clientMin: number
    travelMin: number
    travelKm: number | null
    /** Km percorrido (GPS); vazio enquanto o dia não foi calculado */
    gpsKm: number | null
    /** Parte do km percorrido que é rota estimada (faltou GPS) */
    gpsEstimatedKm: number | null
    gpsCoverage: GpsCoverage | null
    /** O dia tem deslocamento, mas o km percorrido ainda não foi calculado (dia aberto ou encerrado há pouco) */
    gpsPending: boolean
  }[] = []

  const dayGroups = [...groups.values()]
  const travels = await Promise.all(dayGroups.map(computeTravel))
  const sources = travels.flatMap((t) => t.sources)
  const gpsModes: DistanceMode[] = []

  for (const [i, dayVisits] of dayGroups.entries()) {
    const { travel } = travels[i]!
    const dayRows = dayVisits.map((v) => toRow(v, travel.get(v.id)))
    rows.push(...dayRows)
    const first = dayVisits[0]!
    const wd = first.workDay
    const lunchMin = wd.lunchStartedAt && wd.lunchEndedAt ? minutesBetween(wd.lunchStartedAt, wd.lunchEndedAt) : null
    const gpsKm = sumOrNull(dayRows.map((r) => r.gpsKm))
    const gpsEstimatedKm = sumOrNull(dayRows.map((r) => r.gpsEstimatedKm))
    if (wd.gpsKmMode && gpsKm != null) gpsModes.push(wd.gpsKmMode as DistanceMode)
    days.push({
      date: fromDbDate(first.date),
      promotor: first.promotor,
      workStart: wd.startedAt,
      workEnd: wd.endedAt,
      closedAt: wd.closedAt,
      lunchStart: wd.lunchStartedAt,
      lunchEnd: wd.lunchEndedAt,
      lunchMin,
      lunchOverdue: wd.alerts.length > 0,
      routeOrderWaived: wd.routeOrderWaived,
      workedMin: wd.startedAt && wd.endedAt ? round(minutesBetween(wd.startedAt, wd.endedAt) - (lunchMin ?? 0)) : null,
      total: dayRows.length,
      done: dayRows.filter((r) => r.status === 'CONCLUIDA').length,
      justified: dayRows.filter((r) => r.status === 'JUSTIFICADA').length,
      notDone: dayRows.filter((r) => r.status === 'PENDENTE').length,
      clientMin: round(dayRows.reduce((s, r) => s + (r.durationMin ?? 0), 0)),
      travelMin: round(dayRows.reduce((s, r) => s + (r.travelMin ?? 0), 0)),
      travelKm: sumOrNull(dayRows.map((r) => r.travelKm)),
      gpsKm,
      gpsEstimatedKm,
      gpsCoverage: coverage(gpsKm, gpsEstimatedKm),
      gpsPending: dayRows.some((r) => r.gpsPending),
    })
  }

  const gpsKmSource = gpsModes.length === 0 ? null : gpsModes.every((m) => m === gpsModes[0]) ? gpsModes[0]! : 'misto'
  return { from: filter.from, to: filter.to, travelKmSource: combineSources(sources), gpsKmSource, summary: summarize(rows), days, rows }
}

type Travel = { travelMin: number; travelKm: number | null; afterLunch: boolean; gpsMeters: number | null; gpsEstimatedMeters: number | null }

/**
 * Deslocamento até cada abertura de atendimento (um cliente reaberto no dia tem mais de uma; o
 * deslocamento dele é a soma). Se o almoço caiu no meio, o deslocamento vai só até a abertura do
 * almoço (a volta do almoço é a própria abertura do próximo cliente). O km percorrido (GPS) do trecho
 * vem gravado na abertura que fecha o trecho, depois que o dia é calculado.
 */
async function computeTravel(dayVisits: ReportVisit[]) {
  const result = new Map<string, Travel>()
  const legs: { visitId: string; from: LatLng; to: LatLng }[] = []
  const sessions = dayVisits.flatMap((v) => v.sessions.map((s) => ({ ...s, visit: v })))
  const lunchStart = dayVisits[0]?.workDay.lunchStartedAt ?? null
  const gpsDone = !!dayVisits[0]?.workDay.gpsKmAt

  for (const { from, to, start } of travelLegs(sessions)) {
    const v = to.visit
    const afterLunch = !!lunchStart && lunchStart >= start && lunchStart <= to.checkinAt
    const prev = result.get(v.id)
    const gps = gpsDone && to.gpsMeters != null
    result.set(v.id, {
      travelMin: round((prev?.travelMin ?? 0) + minutesBetween(start, afterLunch ? lunchStart! : to.checkinAt)),
      travelKm: prev?.travelKm ?? null,
      afterLunch: afterLunch || !!prev?.afterLunch,
      gpsMeters: gps ? (prev?.gpsMeters ?? 0) + to.gpsMeters! : (prev?.gpsMeters ?? null),
      gpsEstimatedMeters: gps ? (prev?.gpsEstimatedMeters ?? 0) + (to.gpsEstimatedMeters ?? 0) : (prev?.gpsEstimatedMeters ?? null),
    })
    const there = pointOf(from.visit.client)
    const here = pointOf(v.client)
    if (there && here) legs.push({ visitId: v.id, from: there, to: here })
  }

  const distances = await legDistances(legs.map((l) => [l.from, l.to]))
  for (const [i, leg] of legs.entries()) {
    const travel = result.get(leg.visitId)!
    travel.travelKm = (travel.travelKm ?? 0) + distances[i]!.meters / 1000
  }
  for (const travel of result.values()) if (travel.travelKm != null) travel.travelKm = round(travel.travelKm)
  return { travel: result, sources: distances.map((d): DistanceSource => d.source) }
}

function sumOrNull(values: (number | null)[]) {
  const present = values.filter((n): n is number => n != null)
  return present.length ? round(present.reduce((s, n) => s + n, 0)) : null
}

function toRow(v: ReportVisit, travel?: Travel) {
  return {
    id: v.id,
    date: fromDbDate(v.date),
    promotor: v.promotor,
    position: v.position,
    origin: v.origin,
    status: v.status,
    modules: v.modules,
    stockConfirmedAt: v.stockConfirmedAt,
    client: { id: v.client.id, name: v.client.name, city: v.client.city },
    checkinAt: v.checkinAt,
    checkoutAt: v.checkoutAt,
    // Tempo no cliente = soma das aberturas encerradas
    durationMin: v.sessions.some((s) => s.checkoutAt)
      ? round(v.sessions.reduce((sum, s) => sum + (s.checkoutAt ? minutesBetween(s.checkinAt, s.checkoutAt) : 0), 0))
      : null,
    sessions: v.sessions.map((s) => ({ checkinAt: s.checkinAt, checkoutAt: s.checkoutAt, autoClosed: s.autoClosed })),
    travelMin: travel?.travelMin ?? null,
    travelKm: travel?.travelKm ?? null,
    afterLunch: travel?.afterLunch ?? false,
    gpsKm: travel?.gpsMeters != null ? round(travel.gpsMeters / 1000) : null,
    gpsEstimatedKm: travel?.gpsMeters != null ? round((travel.gpsEstimatedMeters ?? 0) / 1000) : null,
    gpsCoverage: coverage(travel?.gpsMeters, travel?.gpsEstimatedMeters),
    gpsPending: !!travel && !v.workDay.gpsKmAt,
    checkinDistance: v.checkinDistance,
    geofenceWaived: v.geofenceWaived,
    photosWaived: v.photosWaived,
    autoClosed: v.autoClosed,
    photoCount: v._count.photos,
    ruptures: v.ruptures.map((r) => r.product),
    justification: v.justifiedAt ? { reason: v.justificationReason?.label ?? null, text: v.justificationText, at: v.justifiedAt } : null,
    approvedRequests: v.requests.map((r) => r.type),
  }
}

type Row = ReturnType<typeof toRow>

function summarize(rows: Row[]) {
  const byPromotor = new Map<string, Row[]>()
  for (const r of rows) byPromotor.set(r.promotor.id, [...(byPromotor.get(r.promotor.id) ?? []), r])

  return [...byPromotor.values()].map((list) => {
    const done = list.filter((r) => r.status === 'CONCLUIDA')
    const durations = done.map((r) => r.durationMin).filter((n): n is number => n != null)
    const travels = list.map((r) => r.travelMin).filter((n): n is number => n != null)
    const reasons: Record<string, number> = {}
    for (const r of list) if (r.justification) reasons[r.justification.reason ?? 'Sem motivo'] = (reasons[r.justification.reason ?? 'Sem motivo'] ?? 0) + 1
    const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0)
    return {
      promotor: list[0]!.promotor,
      days: new Set(list.map((r) => r.date)).size,
      total: list.length,
      planned: list.filter((r) => r.origin !== 'EXTRA').length,
      extras: list.filter((r) => r.origin === 'EXTRA').length,
      done: done.length,
      justified: list.filter((r) => r.status === 'JUSTIFICADA').length,
      notDone: list.filter((r) => r.status === 'PENDENTE').length,
      inProgress: list.filter((r) => r.status === 'EM_ATENDIMENTO').length,
      executionRate: list.length ? round((done.length / list.length) * 100) : 0,
      totalClientMin: round(sum(durations)),
      avgClientMin: durations.length ? round(sum(durations) / durations.length) : null,
      totalTravelMin: round(sum(travels)),
      avgTravelMin: travels.length ? round(sum(travels) / travels.length) : null,
      totalTravelKm: sumOrNull(list.map((r) => r.travelKm)),
      totalGpsKm: sumOrNull(list.map((r) => r.gpsKm)),
      totalGpsEstimatedKm: sumOrNull(list.map((r) => r.gpsEstimatedKm)),
      gpsPendingDays: new Set(list.filter((r) => r.gpsPending).map((r) => r.date)).size,
      geofenceWaivers: list.filter((r) => r.geofenceWaived).length,
      photoWaivers: list.filter((r) => r.photosWaived).length,
      autoClosed: list.filter((r) => r.autoClosed).length,
      ruptures: list.reduce((s, r) => s + r.ruptures.length, 0),
      justificationsByReason: reasons,
    }
  })
}
