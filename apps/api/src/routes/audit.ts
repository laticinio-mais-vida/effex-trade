import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, type AuthUser } from '../auth'
import { AuditStatus, PhotoType, prisma, Prisma } from '../db'
import { addDays, fromDbDate, toDbDate, todayIn } from '../lib/dates'
import { conflict, notFound } from '../lib/errors'
import { parse, zDate, zId, zIdParam, zList, zPage } from '../lib/validate'
import { photoScope } from '../services/scope'
import { serializePhoto } from '../services/serializers'

export const auditPhotoInclude = {
  visit: { include: { client: true, promotor: { select: { id: true, name: true } } } },
  products: { include: { product: true } },
  audits: { include: { auditor: { select: { id: true, name: true, role: true } }, review: { include: { supervisor: { select: { id: true, name: true } } } } } },
} satisfies Prisma.PhotoInclude

type AuditPhoto = Prisma.PhotoGetPayload<{ include: typeof auditPhotoInclude }>

function serializeAudit(a: AuditPhoto['audits'][number]) {
  return {
    id: a.id,
    status: a.status,
    justification: a.justification,
    createdAt: a.createdAt,
    auditor: a.auditor,
    review: a.review ? { verdict: a.review.verdict, comment: a.review.comment, supervisor: a.review.supervisor, createdAt: a.review.createdAt } : null,
  }
}

export function serializeAuditPhoto(photo: AuditPhoto, userId: string) {
  const mine = photo.audits.find((a) => a.auditorId === userId)
  return {
    ...serializePhoto(photo),
    visit: { id: photo.visit.id, date: fromDbDate(photo.visit.date), checkinAt: photo.visit.checkinAt, checkoutAt: photo.visit.checkoutAt },
    client: { id: photo.visit.client.id, name: photo.visit.client.name, city: photo.visit.client.city },
    promotor: photo.visit.promotor,
    myAudit: mine ? serializeAudit(mine) : null,
    otherAudits: photo.audits.filter((a) => a.auditorId !== userId).map(serializeAudit),
  }
}

const listQuery = z.object({
  status: z.enum(['pendentes', 'auditadas', 'todas']).default('pendentes'),
  from: zDate.optional(),
  to: zDate.optional(),
  clientId: zList(zId).optional(),
  promotorId: zList(zId).optional(),
  type: zList(z.enum(PhotoType)).optional(),
  ...zPage,
})

async function auditWhere(user: AuthUser, q: z.infer<typeof listQuery>): Promise<Prisma.PhotoWhereInput> {
  const to = q.to ?? todayIn()
  const from = q.from ?? addDays(to, -7)
  return {
    AND: [
      await photoScope(user),
      { visit: { date: { gte: toDbDate(from), lte: toDbDate(to) } } },
      q.clientId?.length ? { visit: { clientId: { in: q.clientId } } } : {},
      q.promotorId?.length ? { visit: { promotorId: { in: q.promotorId } } } : {},
      q.type?.length ? { type: { in: q.type } } : {},
      q.status === 'pendentes' ? { audits: { none: { auditorId: user.sub } } } : {},
      q.status === 'auditadas' ? { audits: { some: { auditorId: user.sub } } } : {},
    ],
  }
}

/** Auditoria de fotos pelo vendedor e pelo supervisor: fotos dos clientes das cidades de cada um. */
export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('VENDEDOR', 'SUPERVISOR', 'ADMIN'))

  app.get('/photos', async (req) => {
    const q = parse(listQuery, req.query)
    const where = await auditWhere(req.user, q)
    const [total, photos] = await Promise.all([
      prisma.photo.count({ where }),
      prisma.photo.findMany({
        where,
        include: auditPhotoInclude,
        orderBy: [{ visit: { date: 'desc' } }, { takenAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ])
    return { total, page: q.page, pageSize: q.pageSize, items: photos.map((p) => serializeAuditPhoto(p, req.user.sub)) }
  })

  app.get('/summary', async (req) => {
    const pending = await prisma.photo.count({ where: await auditWhere(req.user, parse(listQuery, {})) })
    return { pending }
  })

  /**
   * Opções para os filtros do app (clientes e promotores com fotos no escopo do usuário): últimos 60 dias,
   * ampliados até `from` quando o período escolhido começa antes disso.
   */
  app.get('/filters', async (req) => {
    const q = parse(z.object({ from: zDate.optional() }), req.query)
    const scope = await photoScope(req.user)
    const since = addDays(todayIn(), -60)
    const visits = await prisma.visit.findMany({
      where: { photos: { some: scope }, date: { gte: toDbDate(q.from && q.from < since ? q.from : since) } },
      select: { client: { select: { id: true, name: true, city: true } }, promotor: { select: { id: true, name: true } } },
      distinct: ['clientId', 'promotorId'],
    })
    const clients = new Map(visits.map((v) => [v.client.id, v.client]))
    const promotores = new Map(visits.map((v) => [v.promotor.id, v.promotor]))
    return {
      clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)),
      promotores: [...promotores.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }
  })

  app.post('/photos/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(
      z
        .object({ status: z.enum(AuditStatus), justification: z.string().trim().max(1000).optional() })
        .refine((b) => b.status === 'APROVADA' || (b.justification?.length ?? 0) >= 5, {
          message: 'informe a justificativa da reprovação (mínimo 5 caracteres)',
          path: ['justification'],
        }),
      req.body,
    )
    const photo = await prisma.photo.findFirst({ where: { AND: [{ id }, await photoScope(req.user)] } })
    if (!photo) throw notFound('Foto')

    const existing = await prisma.photoAudit.findUnique({ where: { photoId_auditorId: { photoId: id, auditorId: req.user.sub } }, include: { review: true } })
    if (existing?.review) throw conflict('Esta auditoria já foi conferida pelo supervisor e não pode mais ser alterada.', 'AUDITORIA_CONFERIDA')

    await prisma.photoAudit.upsert({
      where: { photoId_auditorId: { photoId: id, auditorId: req.user.sub } },
      create: { photoId: id, auditorId: req.user.sub, status: body.status, justification: body.justification },
      update: { status: body.status, justification: body.justification },
    })
    const updated = await prisma.photo.findUniqueOrThrow({ where: { id }, include: auditPhotoInclude })
    return serializeAuditPhoto(updated, req.user.sub)
  })
}
