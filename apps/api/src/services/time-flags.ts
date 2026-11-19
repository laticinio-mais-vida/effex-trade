import { prisma } from '../db'
import { env } from '../env'
import { toDbDate, todayIn } from '../lib/dates'
import { badRequest, forbidden, notFound } from '../lib/errors'
import type { AuthUser } from '../auth'
import { pushToTeamOf } from './push'
import { clientRef, getBaseline, limitSeconds, timeReport, travelRef, userKey, type Occurrence, type PromotorDay } from './time-report'

/**
 * Desvios de tempo na hora em que acontecem. A cada check-in e check-out do promotor o relatório de tempos do dia dele é
 * recalculado (services/time-report.ts) e o que passou do limite é gravado em TimeFlag, uma vez por visita e tipo:
 * - tempo no cliente acima da média: avisa o promotor logo após o check-out (e ele pode justificar);
 * - deslocamento acima da média: avisa o promotor ao chegar no cliente seguinte (check-in);
 * - tempo muito curto: só o supervisor (promotorNotified = false).
 * Só avisa com referência firme (a média do próprio cliente; no deslocamento, ao menos a do promotor).
 * A resposta também traz os limites para o app agendar a notificação com o app minimizado: o aviso "você já passou do
 * normal" no horário em que o tempo passa do limite, sem esperar a saída.
 */

export type TimingFlag = { id: string; kind: 'ROTEIRO' | 'DESLOCAMENTO'; clientName: string; city: string | null; valueSeconds: number; baseSeconds: number; diffSeconds: number }

export type Timing = {
  /** Desvios novos desta chamada, para avisar o promotor (só tempo acima da média) */
  flags: TimingFlag[]
  /** Atendimento aberto: daqui a quantos segundos ele passa do limite de tempo no cliente */
  stayLimit: { visitId: string; clientName: string; afterSeconds: number; baseSeconds: number } | null
  /** Depois da saída: daqui a quantos segundos o deslocamento passa do limite (média do promotor) */
  travelLimit: { afterSeconds: number; baseSeconds: number } | null
}

const EMPTY: Timing = { flags: [], stayLimit: null, travelLimit: null }

export const MIN_FLAG_JUSTIFICATION = 5

/** Registra os desvios novos e calcula os limites. Nunca derruba o check-in/check-out: erro vira "sem aviso". */
export async function processTimeEvents(promotorId: string, event: 'checkin' | 'checkout'): Promise<Timing> {
  try {
    return await run(promotorId, event)
  } catch (e) {
    console.error('relatório de tempos: falha ao processar o evento', e)
    return EMPTY
  }
}

async function run(promotorId: string, event: 'checkin' | 'checkout'): Promise<Timing> {
  const today = todayIn(env.timezone)
  const report = await timeReport(today, { promotorIds: [promotorId] })
  const day = report.promotores[0]
  if (!day || report.source !== 'EFFEX' || !report.baseline) return EMPTY

  // Desvios que merecem aviso: acima da média, ou muito curtos (só supervisor); sempre com referência firme
  const wanted = day.occurrences.filter((o) => o.reliable && (o.direction === 'ACIMA' || o.veryShort))
  const flags = await saveNewFlags(promotorId, today, wanted)

  const baseline = await getBaseline(today)
  let stayLimit: Timing['stayLimit'] = null
  let travelLimit: Timing['travelLimit'] = null
  if (event === 'checkin') {
    const open = await prisma.visit.findFirst({
      where: { promotorId, date: toDbDate(today), status: 'EM_ATENDIMENTO' },
      include: { client: { select: { name: true, document: true } }, sessions: true },
    })
    const ref = open ? clientRef(baseline, open.client.document) : null
    if (open && ref && !ref.fallback) {
      const done = open.sessions.reduce((s, x) => s + (x.checkoutAt ? Math.round((x.checkoutAt.getTime() - x.checkinAt.getTime()) / 1000) : 0), 0)
      stayLimit = { visitId: open.id, clientName: open.client.name, afterSeconds: Math.max(60, Math.round(limitSeconds(ref.base) - done)), baseSeconds: Math.round(ref.base) }
    }
  } else {
    const remaining = await prisma.visit.count({ where: { promotorId, date: toDbDate(today), status: { in: ['PENDENTE', 'EM_ATENDIMENTO'] } } })
    const ref = remaining > 0 ? travelRef(baseline, userKey(promotorId), null) : null
    if (ref && ref.level !== 'GERAL') travelLimit = { afterSeconds: Math.round(limitSeconds(ref.base)), baseSeconds: Math.round(ref.base) }
  }
  return { flags, stayLimit, travelLimit }
}

async function saveNewFlags(promotorId: string, date: string, wanted: Occurrence[]): Promise<TimingFlag[]> {
  if (!wanted.length) return []
  const existing = await prisma.timeFlag.findMany({ where: { visitId: { in: wanted.map((o) => o.rowId) } }, select: { visitId: true, kind: true } })
  const had = new Set(existing.map((f) => `${f.visitId}|${f.kind}`))
  const fresh = wanted.filter((o) => !had.has(`${o.rowId}|${o.kind}`))
  if (!fresh.length) return []
  await prisma.timeFlag.createMany({
    data: fresh.map((o) => ({
      visitId: o.rowId,
      promotorId,
      date: toDbDate(date),
      kind: o.kind,
      direction: o.direction,
      valueSeconds: Math.round(o.valueSeconds),
      baseSeconds: Math.round(o.baseSeconds),
      fallback: o.fallback,
      promotorNotified: o.direction === 'ACIMA',
    })),
    skipDuplicates: true,
  })
  void notifyTeam(promotorId, fresh)
  const saved = await prisma.timeFlag.findMany({ where: { visitId: { in: fresh.map((o) => o.rowId) }, direction: 'ACIMA' }, select: { id: true, visitId: true, kind: true } })
  const idByKey = new Map(saved.map((f) => [`${f.visitId}|${f.kind}`, f.id]))
  return fresh
    .filter((o) => o.direction === 'ACIMA')
    .map((o) => ({
      id: idByKey.get(`${o.rowId}|${o.kind}`)!,
      kind: o.kind,
      clientName: o.clientName,
      city: o.city,
      valueSeconds: Math.round(o.valueSeconds),
      baseSeconds: Math.round(o.baseSeconds),
      diffSeconds: Math.round(o.diffSeconds),
    }))
    .filter((f) => f.id)
}

// ---------- Push ao supervisor ----------

const pad2 = (n: number) => String(n).padStart(2, '0')
const short = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${pad2(Math.floor((s % 3600) / 60))}` : `${Math.max(1, Math.round(s / 60))} min`)

/** Avisa o supervisor (push) de cada desvio novo: acima da média ou muito curto. */
async function notifyTeam(promotorId: string, fresh: Occurrence[]) {
  try {
    const who = (await prisma.user.findUnique({ where: { id: promotorId }, select: { name: true } }))?.name ?? 'Promotor'
    for (const o of fresh) {
      const value = Math.round(o.valueSeconds)
      const base = Math.round(o.baseSeconds)
      const [title, body] =
        o.kind === 'DESLOCAMENTO'
          ? ['Deslocamento acima da média', `${who} levou ${short(value)} até ${o.clientName} (normal: ${short(base)}).`]
          : o.direction === 'ACIMA'
            ? ['Tempo acima da média', `${who} ficou ${short(value)} em ${o.clientName} (normal: ${short(base)}).`]
            : ['Tempo muito curto no cliente', `${who} ficou só ${short(value)} em ${o.clientName} (normal: ${short(base)}).`]
      await pushToTeamOf(promotorId, { title, body, screen: 'tempos' })
    }
  } catch (e) {
    console.error('push: falha ao avisar o supervisor do desvio', e instanceof Error ? e.message : e)
  }
}

// ---------- Visão do promotor ----------

/** O dia do próprio promotor: resumo, desvios acima da média (com a justificativa dele) e o que está em andamento. */
export async function promotorTimeView(promotorId: string, date: string) {
  const report = await timeReport(date, { promotorIds: [promotorId] })
  const day: PromotorDay | undefined = report.promotores[0]
  return {
    date: report.date,
    isToday: report.isToday,
    source: report.source,
    generatedAt: report.generatedAt,
    warnings: report.warnings,
    day: day && { ...day, occurrences: day.occurrences.filter((o) => o.direction === 'ACIMA' && o.reliable) },
  }
}

/** O promotor explica um desvio dele (pode refazer enquanto o supervisor não deu ciente). */
export async function justifyFlag(promotorId: string, flagId: string, text: string) {
  const clean = text.trim()
  if (clean.length < MIN_FLAG_JUSTIFICATION) throw badRequest(`Escreva pelo menos ${MIN_FLAG_JUSTIFICATION} caracteres.`)
  const flag = await prisma.timeFlag.findUnique({ where: { id: flagId } })
  if (!flag || flag.promotorId !== promotorId || !flag.promotorNotified) throw notFound('Desvio')
  if (flag.acknowledgedAt) throw badRequest('O supervisor já deu ciente neste desvio.')
  const saved = await prisma.timeFlag.update({ where: { id: flagId }, data: { justification: clean.slice(0, 1000), justifiedAt: new Date() } })
  return { id: saved.id, justification: saved.justification, justifiedAt: saved.justifiedAt }
}

// ---------- Supervisor ----------

const teamFilter = (user: AuthUser) => (user.role === 'ADMIN' ? {} : { promotor: { supervisorId: user.sub } })

/** O supervisor dá ciente num desvio da equipe dele (o administrador, em qualquer um). */
export async function acknowledgeFlag(user: AuthUser, flagId: string) {
  const flag = await prisma.timeFlag.findFirst({ where: { id: flagId, ...teamFilter(user) } })
  if (!flag) throw forbidden('Este desvio não é de um promotor da sua equipe.')
  if (flag.acknowledgedAt) return { id: flag.id, acknowledgedAt: flag.acknowledgedAt }
  const saved = await prisma.timeFlag.update({ where: { id: flagId }, data: { acknowledgedAt: new Date(), acknowledgedById: user.sub } })
  return { id: saved.id, acknowledgedAt: saved.acknowledgedAt }
}

/** Desvios da equipe ainda sem ciente (de hoje e dos 2 dias anteriores): o contador do app do supervisor. */
export async function pendingTimeFlags(user: AuthUser) {
  const since = new Date(toDbDate(todayIn(env.timezone)).getTime() - 2 * 86_400_000)
  return prisma.timeFlag.count({ where: { acknowledgedAt: null, date: { gte: since }, ...teamFilter(user) } })
}
