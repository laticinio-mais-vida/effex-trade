import { z } from 'zod'
import type { AuthUser } from '../auth'
import { prisma, Prisma } from '../db'
import { fromDbDate, localDayRange, todayIn } from '../lib/dates'
import { conflict, forbidden, notFound } from '../lib/errors'
import { promotorScope } from './scope'
import { serializePhoto } from './serializers'

/** O promotor vê as fotos reprovadas (e as contestações) dos últimos 14 dias. */
export const CONTEST_WINDOW_DAYS = 14
/** Contestações por promotor em cada dia. */
export const CONTESTS_PER_DAY = 2
const MIN_TEXT = 5

/**
 * Reprovação que vale contra o promotor: auditoria REPROVADA, menos a do vendedor que o supervisor conferiu como
 * incorreta (o supervisor disse que a foto deveria ter sido aprovada).
 */
export const activeRejection: Prisma.PhotoAuditWhereInput = {
  status: 'REPROVADA',
  NOT: { AND: [{ auditor: { role: 'VENDEDOR' } }, { review: { is: { verdict: 'INCORRETA' } } }] },
}

function isActiveRejection(a: { status: string; auditor: { role: string }; review: { verdict: string } | null }) {
  return a.status === 'REPROVADA' && !(a.auditor.role === 'VENDEDOR' && a.review?.verdict === 'INCORRETA')
}

const windowStart = () => new Date(Date.now() - CONTEST_WINDOW_DAYS * 86_400_000)

const auditInclude = {
  auditor: { select: { id: true, name: true, role: true } },
  review: { include: { supervisor: { select: { id: true, name: true } } } },
} satisfies Prisma.PhotoAuditInclude

const photoInclude = {
  visit: { include: { client: { select: { id: true, name: true, city: true } }, promotor: { select: { id: true, name: true } } } },
  audits: { include: auditInclude, orderBy: { updatedAt: 'asc' } },
  products: { include: { product: true } },
  contest: { include: { decidedBy: { select: { id: true, name: true } } } },
} satisfies Prisma.PhotoInclude

type ContestPhoto = Prisma.PhotoGetPayload<{ include: typeof photoInclude }>
type ContestRow = NonNullable<ContestPhoto['contest']>

function serializeContest(c: ContestRow) {
  return {
    id: c.id,
    status: c.status,
    reason: c.reason,
    response: c.response,
    createdAt: c.createdAt,
    decidedAt: c.decidedAt,
    decidedBy: c.decidedBy,
  }
}

function serializeAudits(p: ContestPhoto) {
  return p.audits.map((a) => ({
    id: a.id,
    status: a.status,
    justification: a.justification,
    auditor: a.auditor,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    review: a.review ? { verdict: a.review.verdict, comment: a.review.comment, supervisor: a.review.supervisor, createdAt: a.review.createdAt } : null,
  }))
}

/** Foto reprovada como o promotor a vê: as reprovações que valem e a contestação, se houver. */
function serializeRejectedPhoto(p: ContestPhoto) {
  const rejections = p.audits.filter(isActiveRejection).map((a) => ({
    id: a.id,
    auditor: { name: a.auditor.name, role: a.auditor.role },
    justification: a.justification,
    at: a.updatedAt,
  }))
  return {
    ...serializePhoto(p),
    visit: { id: p.visit.id, date: fromDbDate(p.visit.date) },
    client: p.visit.client,
    rejections,
    contest: p.contest ? serializeContest(p.contest) : null,
    canContest: !p.contest && rejections.length > 0,
  }
}

async function contestsToday(promotorId: string) {
  const { start, end } = localDayRange(todayIn())
  return prisma.photoContest.count({ where: { promotorId, createdAt: { gte: start, lt: end } } })
}

/**
 * Aba Recusadas do promotor: fotos dele reprovadas nos últimos 14 dias (pela data da reprovação) e as que ele
 * contestou nesse período, mesmo que a contestação já tenha sido aceita (para ele ver o resultado).
 */
export async function listRejectedForPromotor(promotorId: string) {
  const since = windowStart()
  const photos = await prisma.photo.findMany({
    where: {
      visit: { promotorId },
      OR: [{ audits: { some: { ...activeRejection, updatedAt: { gte: since } } } }, { contest: { is: { createdAt: { gte: since } } } }],
    },
    include: photoInclude,
    orderBy: [{ visit: { date: 'desc' } }, { takenAt: 'desc' }],
    take: 300,
  })
  const used = await contestsToday(promotorId)
  return {
    windowDays: CONTEST_WINDOW_DAYS,
    limitPerDay: CONTESTS_PER_DAY,
    usedToday: used,
    remainingToday: Math.max(0, CONTESTS_PER_DAY - used),
    items: photos.map(serializeRejectedPhoto),
  }
}

export const contestBodySchema = z.object({
  reason: z.string().trim().min(MIN_TEXT, `explique por que a foto está certa (mínimo ${MIN_TEXT} caracteres)`).max(1000),
})

/** O promotor contesta uma foto dele reprovada: uma contestação por foto, até 2 por dia. */
export async function createContest(promotorId: string, photoId: string, reason: string) {
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: photoInclude })
  if (!photo || photo.visit.promotorId !== promotorId) throw notFound('Foto')
  if (photo.contest) throw conflict('Esta foto já foi contestada.', 'JA_CONTESTADA')
  if (!photo.audits.some(isActiveRejection)) throw conflict('Esta foto não está reprovada.', 'FOTO_NAO_REPROVADA')
  const since = windowStart()
  if (!photo.audits.some((a) => isActiveRejection(a) && a.updatedAt >= since)) {
    throw conflict(`Só dá para contestar reprovações dos últimos ${CONTEST_WINDOW_DAYS} dias.`, 'CONTESTACAO_FORA_DO_PRAZO')
  }
  await prisma.$transaction(
    async (tx) => {
      const { start, end } = localDayRange(todayIn())
      const used = await tx.photoContest.count({ where: { promotorId, createdAt: { gte: start, lt: end } } })
      if (used >= CONTESTS_PER_DAY) {
        throw conflict(`Você já contestou ${CONTESTS_PER_DAY} fotos hoje. Amanhã pode contestar outras.`, 'LIMITE_CONTESTACOES')
      }
      await tx.photoContest.create({ data: { photoId, promotorId, reason } })
    },
    { isolationLevel: 'Serializable' },
  )
  const updated = await prisma.photo.findUniqueOrThrow({ where: { id: photoId }, include: photoInclude })
  const used = await contestsToday(promotorId)
  return { item: serializeRejectedPhoto(updated), usedToday: used, remainingToday: Math.max(0, CONTESTS_PER_DAY - used) }
}

// ---------------- Supervisor e administrador ----------------

const contestInclude = {
  promotor: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  photo: { include: photoInclude },
} satisfies Prisma.PhotoContestInclude

type Contest = Prisma.PhotoContestGetPayload<{ include: typeof contestInclude }>

export function serializeContestForSupervisor(c: Contest) {
  const p = c.photo
  return {
    ...serializeContest(c),
    promotor: c.promotor,
    photo: serializePhoto(p),
    visit: { id: p.visit.id, date: fromDbDate(p.visit.date) },
    client: p.visit.client,
    /** Todas as auditorias da foto (as reprovações contestadas e as demais) */
    audits: serializeAudits(p),
  }
}

export const contestListQuery = z.object({
  state: z.enum(['pendentes', 'decididas', 'todas']).default('pendentes'),
  promotorId: z.string().min(1).optional(),
})

/** Contestações dos promotores da equipe (o supervisor responsável por eles) ou de todos (administrador). */
export function contestWhere(user: AuthUser, q: z.infer<typeof contestListQuery>): Prisma.PhotoContestWhereInput {
  return {
    promotor: { ...promotorScope(user), ...(q.promotorId ? { id: q.promotorId } : {}) },
    ...(q.state === 'pendentes' ? { status: 'PENDENTE' } : q.state === 'decididas' ? { status: { not: 'PENDENTE' } } : {}),
  }
}

export async function listContests(user: AuthUser, q: z.infer<typeof contestListQuery>, page: number, pageSize: number) {
  const where = contestWhere(user, q)
  const [total, contests] = await Promise.all([
    prisma.photoContest.count({ where }),
    prisma.photoContest.findMany({
      where,
      include: contestInclude,
      // Pendentes: as mais antigas primeiro (fila); decididas: as mais recentes primeiro
      orderBy: q.state === 'pendentes' ? { createdAt: 'asc' } : { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { total, page, pageSize, items: contests.map(serializeContestForSupervisor) }
}

export function pendingContestsCount(user: AuthUser) {
  return prisma.photoContest.count({ where: contestWhere(user, { state: 'pendentes' }) })
}

export const decideBodySchema = z
  .object({ decision: z.enum(['ACEITA', 'NEGADA']), response: z.string().trim().max(1000).optional() })
  .refine((b) => b.decision === 'ACEITA' || (b.response?.length ?? 0) >= MIN_TEXT, {
    message: `explique ao promotor por que a reprovação continua (mínimo ${MIN_TEXT} caracteres)`,
    path: ['response'],
  })

/**
 * Decide a contestação. Aceita: a foto passa a valer como aprovada. A reprovação de vendedor fica conferida como
 * incorreta (entra no PDF de correções dele); a de supervisor ou administrador vira aprovação. Negada: a reprovação
 * continua e o promotor vê a resposta. A decisão é final.
 */
export async function decideContest(user: AuthUser, contestId: string, body: z.infer<typeof decideBodySchema>) {
  const contest = await prisma.photoContest.findUnique({ where: { id: contestId }, include: contestInclude })
  if (!contest) throw notFound('Contestação')
  const inScope = await prisma.user.count({ where: { id: contest.promotorId, ...promotorScope(user) } })
  if (!inScope) throw forbidden('Este promotor não pertence à sua equipe.')
  if (contest.status !== 'PENDENTE') throw conflict('Esta contestação já foi decidida.', 'CONTESTACAO_DECIDIDA')
  const response = body.response || null

  await prisma.$transaction(async (tx) => {
    const updated = await tx.photoContest.updateMany({
      where: { id: contestId, status: 'PENDENTE' },
      data: { status: body.decision, response, decidedById: user.sub, decidedAt: new Date() },
    })
    if (updated.count === 0) throw conflict('Esta contestação já foi decidida.', 'CONTESTACAO_DECIDIDA')
    if (body.decision !== 'ACEITA') return
    const note = `Foto aprovada após contestação do promotor ("${contest.reason}").${response ? ` ${response}` : ''}`
    for (const audit of contest.photo.audits.filter(isActiveRejection)) {
      if (audit.auditor.role === 'VENDEDOR') {
        await tx.auditReview.upsert({
          where: { auditId: audit.id },
          create: { auditId: audit.id, supervisorId: user.sub, verdict: 'INCORRETA', comment: note },
          update: { supervisorId: user.sub, verdict: 'INCORRETA', comment: note },
        })
      } else {
        await tx.photoAudit.update({ where: { id: audit.id }, data: { status: 'APROVADA', justification: note } })
      }
    }
  })
  return serializeContestForSupervisor(await prisma.photoContest.findUniqueOrThrow({ where: { id: contestId }, include: contestInclude }))
}
