import { prisma, type Prisma } from '../db'
import { env } from '../env'
import { addDays, fromDbDate, toDbDate, todayIn } from '../lib/dates'
import { nameKey } from '../lib/cities'
import { badRequest } from '../lib/errors'
import type { AuthUser } from '../auth'
import { travelLegs } from './reports'
import { promotorScope } from './scope'

/**
 * Relatório de tempos da promotoria: compara o tempo em cada cliente e o deslocamento de cada promotor com o histórico
 * e sinaliza o que foge do normal. Regras (documento de especificação do relatório diário):
 * - visita = tempo no cliente > 0; o resto do roteiro do dia é "não visitado" (fora das medianas e dos limiares);
 * - referência = MEDIANA das visitas anteriores ao dia (nunca média: check-out esquecido destrói a média);
 *   tempo no cliente: por cliente (todos os promotores); deslocamento: por promotor + cliente;
 *   com menos de 3 observações no grupo, vale a mediana geral (do promotor, no deslocamento) e a linha leva "*";
 * - sinaliza quando o valor passa de 2x a referência E fica 15 min acima dela (ou 0,5x e 15 min abaixo, só no tempo no
 *   cliente: deslocamento curto é rota bem feita e não é sinalizado);
 * - o histórico junta o importado do TradePro (TimeHistory) com as visitas do EFFEX; dia que existe no EFFEX vale o dele.
 * O deslocamento nativo segue a regra do relatório de execução: do check-out anterior ao check-in seguinte, cortado no
 * início do almoço e sem as pausas de roteiro reaberto.
 */

export const MIN_OBSERVATIONS = 3
export const RATIO_LIMIT = 2
export const MIN_DIFF_SECONDS = 15 * 60
export const WINDOW_MONTHS = 3
/** Tempo "muito curto" (o supervisor é avisado): até um quarto da média, e 15 min abaixo dela */
export const VERY_SHORT_RATIO = 0.25

export type RowState = 'FEITA' | 'EM_ATENDIMENTO' | 'JUSTIFICADA' | 'PENDENTE' | 'NAO_FEITA'
export type Source = 'EFFEX' | 'TRADEPRO'

type DayRow = {
  id: string
  date: string
  source: Source
  promotorKey: string
  promotorId: string | null
  promotorName: string
  supervisorName: string | null
  clientKey: string | null
  clientName: string
  city: string | null
  checkinAt: Date | null
  checkoutAt: Date | null
  clientSeconds: number
  travelSeconds: number
  state: RowState
  reason: string | null
  comment: string | null
  /** Atendimento aberto agora: início da abertura em andamento */
  openSince: Date | null
}

type Obs = { promotorKey: string; clientKey: string | null; clientSeconds: number; travelSeconds: number }

// ---------- Funções puras ----------

export function median(values: number[]) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Compara o valor com a referência: acima (>= 2x e +15 min) ou abaixo (<= 0,5x e -15 min). */
export function judge(value: number, base: number) {
  const diff = value - base
  const ratio = base > 0 ? value / base : Infinity
  return {
    diff,
    ratio,
    above: ratio >= RATIO_LIMIT && diff >= MIN_DIFF_SECONDS,
    below: ratio <= 1 / RATIO_LIMIT && diff <= -MIN_DIFF_SECONDS,
    veryShort: ratio <= VERY_SHORT_RATIO && diff <= -MIN_DIFF_SECONDS,
  }
}

/** A partir de quantos segundos o tempo passa a ser "acima da média": 2x a média e 15 min acima dela. */
export const limitSeconds = (base: number) => Math.max(base * RATIO_LIMIT, base + MIN_DIFF_SECONDS)

const localDay = (d: Date) => todayIn(env.timezone, d)
const seconds = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))
export const userKey = (id: string) => `u:${id}`

// ---------- Visitas do EFFEX ----------

const nativeInclude = {
  client: { select: { id: true, name: true, city: true, document: true } },
  promotor: { select: { id: true, name: true, supervisor: { select: { name: true } } } },
  justificationReason: { select: { label: true } },
  sessions: { orderBy: { checkinAt: 'asc' } },
  workDay: { select: { closedAt: true, lunchStartedAt: true, lunchEndedAt: true, reopens: { select: { endedAt: true, closedAt: true, reopenedAt: true } } } },
} satisfies Prisma.VisitInclude

type NativeVisit = Prisma.VisitGetPayload<{ include: typeof nativeInclude }>

/** Deslocamento (segundos) até cada visita do dia, pela mesma regra do relatório de execução (reports.ts, computeTravel). */
function nativeTravel(visits: NativeVisit[]) {
  const result = new Map<string, number>()
  const byDay = new Map<string, NativeVisit[]>()
  for (const v of visits) byDay.set(v.workDayId, [...(byDay.get(v.workDayId) ?? []), v])
  for (const day of byDay.values()) {
    const wd = day[0]!.workDay
    const pauses = wd.reopens.map((r) => ({ from: r.endedAt ?? r.closedAt, to: r.reopenedAt })).filter((p) => p.from < p.to)
    const sessions = day.flatMap((v) => v.sessions.map((s) => ({ ...s, visitId: v.id })))
    for (const { to, start: legStart } of travelLegs(sessions)) {
      let start = legStart
      for (const p of pauses) if (p.to > start && p.from < to.checkinAt && p.to <= to.checkinAt) start = p.to
      const afterLunch = !!wd.lunchStartedAt && wd.lunchStartedAt >= start && wd.lunchStartedAt <= to.checkinAt
      result.set(to.visitId, (result.get(to.visitId) ?? 0) + seconds(start, afterLunch ? wd.lunchStartedAt! : to.checkinAt))
    }
  }
  return result
}

const closedSeconds = (v: NativeVisit) => v.sessions.reduce((sum, s) => sum + (s.checkoutAt ? seconds(s.checkinAt, s.checkoutAt) : 0), 0)

function nativeRows(visits: NativeVisit[], today: string): DayRow[] {
  const travel = nativeTravel(visits)
  return visits.map((v): DayRow => {
    const open = v.sessions.find((s) => !s.checkoutAt) ?? null
    const clientSeconds = closedSeconds(v)
    const dayClosed = !!v.workDay.closedAt || fromDbDate(v.date) < today
    const state: RowState = open
      ? 'EM_ATENDIMENTO'
      : clientSeconds > 0
        ? 'FEITA'
        : v.status === 'JUSTIFICADA'
          ? 'JUSTIFICADA'
          : dayClosed
            ? 'NAO_FEITA'
            : 'PENDENTE'
    const closed = v.sessions.filter((s) => s.checkoutAt)
    return {
      id: v.id,
      date: fromDbDate(v.date),
      source: 'EFFEX',
      promotorKey: userKey(v.promotorId),
      promotorId: v.promotorId,
      promotorName: v.promotor.name,
      supervisorName: v.promotor.supervisor?.name ?? null,
      clientKey: v.client.document,
      clientName: v.client.name,
      city: v.client.city,
      checkinAt: v.sessions[0]?.checkinAt ?? null,
      checkoutAt: closed.at(-1)?.checkoutAt ?? null,
      clientSeconds,
      travelSeconds: travel.get(v.id) ?? 0,
      state,
      reason: v.justificationReason?.label ?? null,
      comment: v.justificationText ?? null,
      openSince: open?.checkinAt ?? null,
    }
  })
}

// ---------- Histórico (TradePro) ----------

type HistoryRowDb = Prisma.TimeHistoryGetPayload<object>

function historyRows(rows: HistoryRowDb[]): DayRow[] {
  return rows.map((h): DayRow => {
    const visited = h.clientSeconds > 0
    const justified = !visited && (/justific/i.test(h.status ?? '') || !!h.reason)
    return {
      id: h.id,
      date: fromDbDate(h.date),
      source: 'TRADEPRO',
      promotorKey: h.promotorId ? userKey(h.promotorId) : `n:${h.promotorName}`,
      promotorId: h.promotorId,
      promotorName: h.promotorName,
      supervisorName: h.supervisorName,
      clientKey: h.clientKey,
      clientName: h.clientName,
      city: h.city,
      checkinAt: h.checkinAt,
      checkoutAt: h.checkoutAt,
      clientSeconds: h.clientSeconds,
      travelSeconds: h.travelSeconds,
      state: visited ? 'FEITA' : justified ? 'JUSTIFICADA' : 'NAO_FEITA',
      reason: h.reason,
      comment: h.comment,
      openSince: null,
    }
  })
}

// ---------- Referência (medianas) ----------

export type Baseline = {
  from: string
  to: string
  observations: number
  rotByClient: Map<string, number[]>
  rotAll: number[]
  desByPair: Map<string, number[]>
  desByPromotor: Map<string, number[]>
  desAll: number[]
}

export function buildBaseline(obs: Obs[], from: string, to: string): Baseline {
  const b: Baseline = { from, to, observations: 0, rotByClient: new Map(), rotAll: [], desByPair: new Map(), desByPromotor: new Map(), desAll: [] }
  const push = <K>(m: Map<K, number[]>, k: K, v: number) => m.set(k, [...(m.get(k) ?? []), v])
  for (const o of obs) {
    if (o.clientSeconds > 0) {
      b.observations++
      b.rotAll.push(o.clientSeconds)
      if (o.clientKey) push(b.rotByClient, o.clientKey, o.clientSeconds)
    }
    if (o.travelSeconds > 0) {
      b.desAll.push(o.travelSeconds)
      push(b.desByPromotor, o.promotorKey, o.travelSeconds)
      if (o.clientKey) push(b.desByPair, `${o.promotorKey}|${o.clientKey}`, o.travelSeconds)
    }
  }
  return b
}

/** Origem da média: o próprio grupo, só o promotor (deslocamento) ou todas as visitas. */
type Ref = { base: number; count: number; fallback: boolean; level: 'GRUPO' | 'PROMOTOR' | 'GERAL' }

function groupOrFallback(group: number[] | undefined, fallback: number[], fallbackLevel: Ref['level']): Ref | null {
  if (group && group.length >= MIN_OBSERVATIONS) return { base: median(group)!, count: group.length, fallback: false, level: 'GRUPO' }
  const m = median(fallback)
  return m == null ? null : { base: m, count: fallback.length, fallback: true, level: fallbackLevel }
}

/** Tempo no cliente: mediana do cliente (todos os promotores); sem 3 observações, a de todas as visitas. */
export const clientRef = (b: Baseline, clientKey: string | null) => groupOrFallback(clientKey ? b.rotByClient.get(clientKey) : undefined, b.rotAll, 'GERAL')

/** Deslocamento: mediana do par promotor + cliente; sem 3 observações, a de todos os deslocamentos do promotor (ou a geral, se ele é novo). */
export function travelRef(b: Baseline, promotorKey: string, clientKey: string | null) {
  const own = b.desByPromotor.get(promotorKey)
  return own && own.length
    ? groupOrFallback(clientKey ? b.desByPair.get(`${promotorKey}|${clientKey}`) : undefined, own, 'PROMOTOR')
    : groupOrFallback(clientKey ? b.desByPair.get(`${promotorKey}|${clientKey}`) : undefined, b.desAll, 'GERAL')
}

const baselineCache = new Map<string, { at: number; value: Baseline }>()
const BASELINE_TTL_MS = 10 * 60_000

/** Referência do dia, guardada por alguns minutos: ela só depende de dias anteriores e é pedida a cada check-in e check-out. */
export async function getBaseline(date: string): Promise<Baseline> {
  const hit = baselineCache.get(date)
  if (hit && Date.now() - hit.at < BASELINE_TTL_MS) return hit.value
  const value = await loadBaseline(date)
  baselineCache.set(date, { at: Date.now(), value })
  for (const [d, c] of baselineCache) if (Date.now() - c.at > BASELINE_TTL_MS) baselineCache.delete(d)
  return value
}

async function loadBaseline(date: string): Promise<Baseline> {
  const start = toDbDate(date)
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS)
  const from = fromDbDate(start)
  const range = { gte: start, lt: toDbDate(date) }

  const nativeVisits = await prisma.visit.findMany({
    where: { date: range, status: { not: 'CANCELADA' }, sessions: { some: {} } },
    include: nativeInclude,
  })
  const nativeDates = new Set(nativeVisits.map((v) => fromDbDate(v.date)))
  const history = await prisma.timeHistory.findMany({ where: { date: range, OR: [{ clientSeconds: { gt: 0 } }, { travelSeconds: { gt: 0 } }] } })

  const obs: Obs[] = []
  const byDate = new Map<string, NativeVisit[]>()
  for (const v of nativeVisits) byDate.set(fromDbDate(v.date), [...(byDate.get(fromDbDate(v.date)) ?? []), v])
  for (const [d, visits] of byDate) for (const r of nativeRows(visits, d)) obs.push(r)
  for (const h of historyRows(history)) if (!nativeDates.has(h.date)) obs.push(h)
  return buildBaseline(obs, from, addDays(date, -1))
}

// ---------- Relatório do dia ----------

export type Scope = { promotorIds?: string[]; supervisorName?: string }

/** Admin vê todos; supervisor, só a própria equipe (e as linhas do histórico que citam o nome dele como supervisor). */
export async function timeScopeFor(user: AuthUser): Promise<Scope> {
  if (user.role === 'ADMIN') return {}
  const team = await prisma.user.findMany({ where: promotorScope(user), select: { id: true } })
  return { promotorIds: team.map((t) => t.id), supervisorName: user.name }
}

export type Occurrence = {
  /** Dia (AAAA-MM-DD) em que aconteceu: no relatório de vários dias identifica a linha */
  date: string
  rowId: string
  /** ROTEIRO = tempo no cliente; DESLOCAMENTO = trajeto até o cliente */
  kind: 'ROTEIRO' | 'DESLOCAMENTO'
  direction: 'ACIMA' | 'ABAIXO'
  clientName: string
  city: string | null
  /** Intervalo do evento: a permanência no cliente, ou a saída do cliente anterior até a chegada */
  from: Date | null
  to: Date | null
  valueSeconds: number
  baseSeconds: number
  diffSeconds: number
  ratio: number
  /** Sem 3 observações do próprio grupo: comparado com a mediana geral (leva "*") */
  fallback: boolean
  /** Referência firme o bastante para avisar o promotor: a do próprio cliente (tempo em loja) ou, no deslocamento, ao menos a dele */
  reliable: boolean
  /** Muito abaixo da média (só o supervisor é avisado) */
  veryShort: boolean
  /** Registro na hora do evento (EFFEX): justificativa do promotor e ciente do supervisor */
  flag: { id: string; justification: string | null; justifiedAt: Date | null; acknowledgedAt: Date | null } | null
}

/** Em andamento agora (só no dia de hoje): ainda não vira ocorrência fechada, mas já passou do limite. */
export type LiveAlert = {
  kind: 'ATENDIMENTO_LONGO' | 'DESLOCAMENTO_LONGO'
  clientName: string | null
  city: string | null
  since: Date
  elapsedSeconds: number
  baseSeconds: number
  fallback: boolean
}

export type NotVisited = { date: string; rowId: string; clientName: string; city: string | null; state: RowState; reason: string | null; comment: string | null }

export type PromotorDay = {
  key: string
  id: string | null
  name: string
  supervisor: string | null
  total: number
  visited: number
  inProgress: number
  /** Ainda podem ser visitados (dia em andamento) */
  pending: number
  /** Justificados ou, com o dia encerrado, sem visita nem justificativa */
  notVisited: number
  clientSeconds: number
  travelSeconds: number
  firstCheckin: Date | null
  lastCheckout: Date | null
  /** Visitas do roteiro do dia com check-in em outro dia (roteiro que ficou aberto): ficam fora dos tempos somados */
  outsideDay: number
  occurrences: Occurrence[]
  notVisitedList: NotVisited[]
  live: LiveAlert[]
}

export type TimeReport = {
  /** Primeiro dia do relatório */
  date: string
  /** Último dia (igual a `date` no relatório de um dia só) */
  dateTo: string
  /** De onde vieram as linhas (null: sem nenhum dado; MISTO: período com dias do histórico e do EFFEX) */
  source: Source | 'MISTO' | null
  isToday: boolean
  generatedAt: Date
  baseline: { from: string; to: string; observations: number } | null
  promotores: PromotorDay[]
  warnings: string[]
}

function allowed(row: DayRow, scope: Scope) {
  if (!scope.promotorIds && !scope.supervisorName) return true
  if (row.promotorId && scope.promotorIds?.includes(row.promotorId)) return true
  return !!row.supervisorName && !!scope.supervisorName && sameName(row.supervisorName, scope.supervisorName)
}

/** Mesmo nome, ou um é o início do outro ("EDIR" = "Edir Santos"): o TradePro guarda só o primeiro nome do supervisor. */
function sameName(a: string, b: string) {
  const x = nameKey(a)
  const y = nameKey(b)
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)
}

export async function timeReport(date: string, scope: Scope = {}, now = new Date()): Promise<TimeReport> {
  const today = todayIn(env.timezone, now)
  const warnings: string[] = []
  const base: TimeReport = { date, dateTo: date, source: null, isToday: date === today, generatedAt: now, baseline: null, promotores: [], warnings }
  if (date > today) {
    warnings.push('Esta data ainda não chegou.')
    return base
  }

  // Só a lista de promotores (sem supervisor): consulta só as visitas deles (ex.: o promotor vendo o próprio dia)
  const onlyIds = scope.promotorIds && !scope.supervisorName ? { promotorId: { in: scope.promotorIds } } : {}
  const visits = await prisma.visit.findMany({
    where: { date: toDbDate(date), status: { not: 'CANCELADA' }, ...onlyIds },
    include: nativeInclude,
    orderBy: [{ promotorId: 'asc' }, { position: 'asc' }],
  })
  let rows: DayRow[] = []
  if (visits.length) {
    rows = nativeRows(visits, today)
    base.source = 'EFFEX'
  } else {
    const history = await prisma.timeHistory.findMany({ where: { date: toDbDate(date) }, orderBy: [{ promotorName: 'asc' }, { checkinAt: 'asc' }] })
    rows = historyRows(history)
    if (rows.length) base.source = 'TRADEPRO'
  }
  rows = rows.filter((r) => allowed(r, scope))
  if (!rows.length) {
    warnings.push(base.isToday ? 'Nenhum roteiro lançado hoje ainda.' : 'Nenhum roteiro encontrado nesta data.')
    return base
  }

  const baseline = await getBaseline(date)
  const hasBaseline = baseline.observations > 0
  if (hasBaseline) base.baseline = { from: baseline.from, to: baseline.to, observations: baseline.observations }
  else warnings.push('Não há histórico anterior a esta data para calcular as medianas: nada foi sinalizado.')

  const byPromotor = new Map<string, DayRow[]>()
  for (const r of rows) byPromotor.set(r.promotorKey, [...(byPromotor.get(r.promotorKey) ?? []), r])

  for (const [key, list] of byPromotor) {
    const first = list[0]!
    const done = list.filter((r) => r.state === 'FEITA')
    // Check-in em outro dia: roteiro que ficou aberto, fora dos tempos somados
    const inDay = done.filter((r) => r.checkinAt && localDay(r.checkinAt) === date)
    const day: PromotorDay = {
      key,
      id: first.promotorId,
      name: first.promotorName,
      supervisor: list.find((r) => r.supervisorName)?.supervisorName ?? null,
      total: list.length,
      visited: done.length,
      inProgress: list.filter((r) => r.state === 'EM_ATENDIMENTO').length,
      pending: list.filter((r) => r.state === 'PENDENTE').length,
      notVisited: list.filter((r) => r.state === 'JUSTIFICADA' || r.state === 'NAO_FEITA').length,
      clientSeconds: inDay.reduce((s, r) => s + r.clientSeconds, 0),
      travelSeconds: inDay.reduce((s, r) => s + r.travelSeconds, 0),
      firstCheckin: inDay.reduce<Date | null>((m, r) => (r.checkinAt && (!m || r.checkinAt < m) ? r.checkinAt : m), null),
      lastCheckout: inDay.reduce<Date | null>((m, r) => (r.checkoutAt && (!m || r.checkoutAt > m) ? r.checkoutAt : m), null),
      outsideDay: done.length - inDay.length,
      occurrences: [],
      notVisitedList: list
        .filter((r) => r.state === 'JUSTIFICADA' || r.state === 'NAO_FEITA')
        .map((r) => ({ date, rowId: r.id, clientName: r.clientName, city: r.city, state: r.state, reason: r.reason, comment: r.comment })),
      live: [],
    }

    if (hasBaseline) {
      for (const r of done) {
        const ref = clientRef(baseline, r.clientKey)
        if (ref) {
          const j = judge(r.clientSeconds, ref.base)
          if (j.above || j.below) {
            day.occurrences.push({ date, rowId: r.id, kind: 'ROTEIRO', direction: j.above ? 'ACIMA' : 'ABAIXO', clientName: r.clientName, city: r.city, from: r.checkinAt, to: r.checkoutAt, valueSeconds: r.clientSeconds, baseSeconds: ref.base, diffSeconds: j.diff, ratio: j.ratio, fallback: ref.fallback, reliable: !ref.fallback, veryShort: j.veryShort, flag: null })
          }
        }
        // A primeira visita do dia não tem deslocamento (0) e fica de fora; só o deslocamento acima é sinalizado
        if (r.travelSeconds > 0) {
          const tref = travelRef(baseline, key, r.clientKey)
          if (tref) {
            const j = judge(r.travelSeconds, tref.base)
            if (j.above) {
              day.occurrences.push({ date, rowId: r.id, kind: 'DESLOCAMENTO', direction: 'ACIMA', clientName: r.clientName, city: r.city, from: r.checkinAt ? new Date(r.checkinAt.getTime() - r.travelSeconds * 1000) : null, to: r.checkinAt, valueSeconds: r.travelSeconds, baseSeconds: tref.base, diffSeconds: j.diff, ratio: j.ratio, fallback: tref.fallback, reliable: tref.level !== 'GERAL', veryShort: false, flag: null })
            }
          }
        }
      }
      day.occurrences.sort((a, b) => (a.kind === b.kind ? b.diffSeconds - a.diffSeconds : a.kind === 'DESLOCAMENTO' ? -1 : 1))
    }

    if (hasBaseline && base.isToday && base.source === 'EFFEX') {
      for (const r of list) {
        if (r.state !== 'EM_ATENDIMENTO' || !r.openSince) continue
        const elapsed = r.clientSeconds + seconds(r.openSince, now)
        const ref = clientRef(baseline, r.clientKey)
        if (ref && judge(elapsed, ref.base).above) day.live.push({ kind: 'ATENDIMENTO_LONGO', clientName: r.clientName, city: r.city, since: r.openSince, elapsedSeconds: elapsed, baseSeconds: ref.base, fallback: ref.fallback })
      }
      const open = list.some((r) => r.state === 'EM_ATENDIMENTO')
      const last = list.filter((r) => r.checkoutAt).sort((a, b) => b.checkoutAt!.getTime() - a.checkoutAt!.getTime())[0]
      const wd = visits.find((v) => v.promotorId === first.promotorId)?.workDay
      // A caminho do próximo cliente: saiu do último, não abriu outro, o roteiro segue aberto e o almoço não começou depois
      if (!open && last?.checkoutAt && wd && !wd.closedAt && !(wd.lunchStartedAt && wd.lunchStartedAt >= last.checkoutAt)) {
        const elapsed = seconds(last.checkoutAt, now)
        const tref = travelRef(baseline, key, null)
        if (tref && judge(elapsed, tref.base).above) day.live.push({ kind: 'DESLOCAMENTO_LONGO', clientName: null, city: null, since: last.checkoutAt, elapsedSeconds: elapsed, baseSeconds: tref.base, fallback: true })
      }
    }
    base.promotores.push(day)
  }
  if (base.source === 'EFFEX') {
    const flags = await prisma.timeFlag.findMany({ where: { date: toDbDate(date) } })
    const byKey = new Map(flags.map((f) => [`${f.visitId}|${f.kind}`, f]))
    for (const day of base.promotores) {
      for (const o of day.occurrences) {
        const f = byKey.get(`${o.rowId}|${o.kind}`)
        if (f) o.flag = { id: f.id, justification: f.justification, justifiedAt: f.justifiedAt, acknowledgedAt: f.acknowledgedAt }
      }
    }
  }
  base.promotores.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return base
}

// ---------- Período ----------

/** Máximo de dias de um relatório de período (cada dia é calculado à parte). */
export const MAX_RANGE_DAYS = 31

/** Datas pedidas na consulta: `date` (um dia) ou `from` e `to` (período). Sem nada, hoje. */
export function rangeFromQuery(q: { date?: string; from?: string; to?: string }) {
  const from = q.from ?? q.date ?? q.to ?? todayIn(env.timezone)
  return { from, to: q.to ?? q.date ?? from }
}

/**
 * Relatório de um período: o acumulado dos dias, no mesmo formato do de um dia. É também o relatório "de tarde": hoje
 * vale até o último registro. Cada ocorrência leva o seu dia (`date`) e é comparada com a média daquele dia. Nos
 * totais por promotor, primeira e última visita ficam vazias (horários de dias diferentes não se somam).
 */
export async function timeReportRange(from: string, to: string, scope: Scope = {}, now = new Date()): Promise<TimeReport> {
  if (to < from) throw badRequest('A data final é anterior à inicial.')
  if (from === to) return timeReport(from, scope, now)
  const today = todayIn(env.timezone, now)
  const dates: string[] = []
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) dates.push(d)
  if (dates.length > MAX_RANGE_DAYS) throw badRequest(`Escolha um período de até ${MAX_RANGE_DAYS} dias.`)

  const out: TimeReport = { date: from, dateTo: to, source: null, isToday: to >= today, generatedAt: now, baseline: null, promotores: [], warnings: [] }
  if (!dates.length) {
    out.warnings.push('Este período ainda não chegou.')
    return out
  }
  const reports: TimeReport[] = []
  for (let i = 0; i < dates.length; i += 4) reports.push(...(await Promise.all(dates.slice(i, i + 4).map((d) => timeReport(d, scope, now)))))

  const sources = new Set(reports.map((r) => r.source).filter((x): x is Source => !!x))
  out.source = sources.size > 1 ? 'MISTO' : ([...sources][0] ?? null)
  const withBase = reports.filter((r) => r.baseline)
  if (withBase.length) {
    out.baseline = {
      from: withBase.map((r) => r.baseline!.from).sort()[0]!,
      to: withBase.map((r) => r.baseline!.to).sort().at(-1)!,
      observations: withBase.at(-1)!.baseline!.observations,
    }
  }
  const warnings = new Set(reports.flatMap((r) => r.warnings).filter((w) => !/^Nenhum roteiro/.test(w)))
  out.warnings.push(...warnings)

  const byKey = new Map<string, PromotorDay>()
  for (const r of reports) {
    for (const p of r.promotores) {
      const acc = byKey.get(p.key)
      if (!acc) {
        byKey.set(p.key, { ...p, firstCheckin: null, lastCheckout: null, occurrences: [...p.occurrences], notVisitedList: [...p.notVisitedList], live: [...p.live] })
        continue
      }
      for (const k of ['total', 'visited', 'inProgress', 'pending', 'notVisited', 'clientSeconds', 'travelSeconds', 'outsideDay'] as const) acc[k] += p[k]
      acc.occurrences.push(...p.occurrences)
      acc.notVisitedList.push(...p.notVisitedList)
      acc.live.push(...p.live)
      acc.supervisor ??= p.supervisor
    }
  }
  out.promotores = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  if (!out.promotores.length) out.warnings.push('Nenhum roteiro encontrado neste período.')
  return out
}
