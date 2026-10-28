import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, type AuthUser } from '../auth'
import { prisma, Prisma, RequestStatus, ReviewVerdict } from '../db'
import { addDays, fromDbDate, localDayRange, toDbDate, todayIn } from '../lib/dates'
import { conflict, forbidden, notFound } from '../lib/errors'
import { parse, zDate, zId, zIdParam, zPage } from '../lib/validate'
import {
  createPermissionRequest,
  decidePermissionRequest,
  listPermissionTypes,
  requestInclude,
  serializeRequest,
} from '../services/permissions'
import { alertInclude, checkLunchAlerts, serializeAlert } from '../services/alerts'
import { cancelScheduled, listScheduled, scheduleVisit, SCHEDULE_DAYS_AHEAD } from '../services/scheduled-visits'
import { clientSearch, located } from '../services/clients'
import { areaWhere, clientScope, loadAreas, promotorScope } from '../services/scope'
import { zModules } from '../services/visit-structure'
import { serializeClient, serializePhoto, serializeVisit } from '../services/serializers'
import { getSettings, routeOrderEnforced } from '../services/settings'
import { ensureWorkDay } from '../services/workdays'

/** Vendedores visíveis para o supervisor (admin vê todos). */
function vendedorScope(user: AuthUser): Prisma.UserWhereInput {
  return user.role === 'ADMIN' ? { role: 'VENDEDOR' } : { role: 'VENDEDOR', supervisorId: user.sub }
}

const vendorAuditInclude = {
  auditor: { select: { id: true, name: true } },
  review: { include: { supervisor: { select: { id: true, name: true } } } },
  photo: { include: { products: { include: { product: true } }, visit: { include: { client: true, promotor: { select: { id: true, name: true } } } } } },
} satisfies Prisma.PhotoAuditInclude

type VendorAudit = Prisma.PhotoAuditGetPayload<{ include: typeof vendorAuditInclude }>

function serializeVendorAudit(a: VendorAudit) {
  return {
    id: a.id,
    status: a.status,
    justification: a.justification,
    createdAt: a.createdAt,
    vendedor: a.auditor,
    review: a.review ? { verdict: a.review.verdict, comment: a.review.comment, supervisor: a.review.supervisor, createdAt: a.review.createdAt } : null,
    photo: serializePhoto(a.photo),
    visit: { id: a.photo.visit.id, date: fromDbDate(a.photo.visit.date) },
    client: { id: a.photo.visit.client.id, name: a.photo.visit.client.name, city: a.photo.visit.client.city },
    promotor: a.photo.visit.promotor,
  }
}

export async function supervisorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPERVISOR', 'ADMIN'))

  app.get('/summary', async (req) => {
    await checkLunchAlerts()
    const [pendingRequests, pendingVendorAudits, openAlerts] = await Promise.all([
      prisma.permissionRequest.count({ where: { status: 'PENDENTE', date: toDbDate(todayIn()), promotor: promotorScope(req.user) } }),
      prisma.photoAudit.count({ where: { review: null, auditor: vendedorScope(req.user) } }),
      prisma.alert.count({ where: { acknowledgedAt: null, promotor: promotorScope(req.user) } }),
    ])
    return { pendingRequests, pendingVendorAudits, openAlerts }
  })

  /** Alertas da equipe (ex.: almoço acima do limite). "abertos" = ainda sem "ciente". */
  app.get('/alerts', async (req) => {
    const q = parse(z.object({ state: z.enum(['abertos', 'todos']).default('abertos'), from: zDate.optional(), to: zDate.optional() }), req.query)
    await checkLunchAlerts()
    const to = q.to ?? todayIn()
    const from = q.from ?? addDays(to, -6)
    const alerts = await prisma.alert.findMany({
      where: {
        promotor: promotorScope(req.user),
        ...(q.state === 'abertos' ? { acknowledgedAt: null } : { createdAt: { gte: localDayRange(from).start, lt: localDayRange(to).end } }),
      },
      include: alertInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return alerts.map(serializeAlert)
  })

  app.post('/alerts/:id/ack', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const alert = await prisma.alert.findFirst({ where: { id, promotor: promotorScope(req.user) } })
    if (!alert) throw notFound('Alerta')
    const updated = await prisma.alert.update({
      where: { id },
      data: alert.acknowledgedAt ? {} : { acknowledgedAt: new Date(), acknowledgedById: req.user.sub },
      include: alertInclude,
    })
    return serializeAlert(updated)
  })

  app.get('/team', async (req) => {
    const today = todayIn()
    const [promotores, vendedores] = await Promise.all([
      prisma.user.findMany({ where: { ...promotorScope(req.user), active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        where: { ...vendedorScope(req.user), active: true },
        select: { id: true, name: true, _count: { select: { photoAudits: { where: { review: null } } } } },
        orderBy: { name: 'asc' },
      }),
    ])
    const visits = await prisma.visit.groupBy({
      by: ['promotorId', 'status'],
      where: { date: toDbDate(today), promotorId: { in: promotores.map((p) => p.id) }, status: { not: 'CANCELADA' } },
      _count: true,
    })
    return {
      promotores: promotores.map((p) => {
        const mine = visits.filter((v) => v.promotorId === p.id)
        const count = (s: string) => mine.find((v) => v.status === s)?._count ?? 0
        return {
          ...p,
          today: {
            total: mine.reduce((s, v) => s + v._count, 0),
            done: count('CONCLUIDA'),
            justified: count('JUSTIFICADA'),
            pending: count('PENDENTE'),
            inProgress: count('EM_ATENDIMENTO'),
          },
        }
      }),
      vendedores: vendedores.map((v) => ({ id: v.id, name: v.name, pendingReviews: v._count.photoAudits })),
    }
  })

  /** Roteiro do dia de um promotor da equipe (para liberar ou reordenar direto). */
  app.get('/promotores/:id/day', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const q = parse(z.object({ date: zDate.optional() }), req.query)
    const promotor = await prisma.user.findFirst({ where: { id, ...promotorScope(req.user) }, select: { id: true, name: true } })
    if (!promotor) throw notFound('Promotor')
    const date = q.date ?? todayIn()
    const settings = await getSettings(id)
    const workDay = date === todayIn() ? await ensureWorkDay(id, date) : await prisma.workDay.findUnique({ where: { promotorId_date: { promotorId: id, date: toDbDate(date) } } })
    const visits = workDay
      ? await prisma.visit.findMany({
          where: { workDayId: workDay.id, status: { not: 'CANCELADA' } },
          include: {
            client: true,
            justificationReason: true,
            photos: true,
            requests: { orderBy: { createdAt: 'desc' } },
            scheduledVisit: { include: { createdBy: { select: { name: true } } } },
          },
          orderBy: { position: 'asc' },
        })
      : []
    return {
      promotor,
      date,
      workDay: workDay ? { startedAt: workDay.startedAt, endedAt: workDay.endedAt, closedAt: workDay.closedAt, routeOrderWaived: workDay.routeOrderWaived } : null,
      routeOrderEnforced: routeOrderEnforced(settings, date),
      visits: visits.map((v) => serializeVisit(v)),
      /** Visitas pontuais de hoje em diante (as de hoje também aparecem em visits) */
      scheduled: await listScheduled(req.user, id),
      scheduleDaysAhead: SCHEDULE_DAYS_AHEAD,
    }
  })

  /** Visita pontual: inclui um cliente num único dia do promotor (hoje ou futuro), fora do roteiro fixo. */
  app.post('/promotores/:id/scheduled-visits', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(
      z.object({
        clientId: zId,
        date: zDate,
        note: z.string().trim().max(500).optional(),
        modules: zModules.optional(),
        activity: z.object({ title: z.string().trim().min(3, 'descreva a atividade (mínimo 3 caracteres)').max(200), requiresPhoto: z.boolean().default(true) }).optional(),
      }),
      req.body,
    )
    return scheduleVisit(req.user, { promotorId: id, ...body })
  })

  app.delete('/scheduled-visits/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    await cancelScheduled(req.user, id)
    return { ok: true }
  })

  /** Clientes das cidades do supervisor (e, com promotorId, também das cidades do promotor), com localização. */
  app.get('/clients', async (req) => {
    const q = parse(z.object({ search: z.string().trim().optional(), promotorId: zId.optional() }), req.query)
    let promotorArea: Prisma.ClientWhereInput = {}
    if (q.promotorId) {
      const promotor = await prisma.user.findFirst({ where: { id: q.promotorId, ...promotorScope(req.user) }, select: { id: true } })
      if (!promotor) throw notFound('Promotor')
      promotorArea = areaWhere(await loadAreas(promotor.id))
    }
    const clients = await prisma.client.findMany({
      where: { AND: [await clientScope(req.user), promotorArea, located, { active: true }, q.search ? clientSearch(q.search) : {}] },
      orderBy: { name: 'asc' },
      take: 50,
    })
    return clients.map(serializeClient)
  })

  app.get('/permission-types', async () => listPermissionTypes())

  app.get('/requests', async (req) => {
    const q = parse(z.object({ status: z.enum(RequestStatus).optional(), date: zDate.optional() }), req.query)
    const requests = await prisma.permissionRequest.findMany({
      where: { promotor: promotorScope(req.user), date: toDbDate(q.date ?? todayIn()), ...(q.status ? { status: q.status } : {}) },
      include: requestInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    return requests.map(serializeRequest)
  })

  app.post('/requests/:id/decide', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() }), req.body)
    await decidePermissionRequest(req.user, id, body.approve, body.note)
    return serializeRequest(await prisma.permissionRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }))
  })

  /** Liberação direta, sem pedido do promotor. */
  app.post('/permissions', async (req) => {
    const body = parse(
      z.object({ promotorId: zId, type: z.string().min(1), visitId: zId.optional(), payload: z.unknown().optional(), note: z.string().trim().max(1000).optional() }),
      req.body,
    )
    const created = await createPermissionRequest(req.user, { ...body, reason: body.note }, { note: body.note })
    return serializeRequest(await prisma.permissionRequest.findUniqueOrThrow({ where: { id: created.id }, include: requestInclude }))
  })

  /** Auditorias feitas pelos vendedores da equipe, para o supervisor conferir. */
  app.get('/vendor-audits', async (req) => {
    const q = parse(
      z.object({ state: z.enum(['pendentes', 'conferidas', 'todas']).default('pendentes'), vendedorId: zId.optional(), from: zDate.optional(), to: zDate.optional(), ...zPage }),
      req.query,
    )
    const to = q.to ?? todayIn()
    const from = q.from ?? addDays(to, -30)
    const where: Prisma.PhotoAuditWhereInput = {
      auditor: { ...vendedorScope(req.user), ...(q.vendedorId ? { id: q.vendedorId } : {}) },
      createdAt: { gte: localDayRange(from).start, lt: localDayRange(to).end },
      ...(q.state === 'pendentes' ? { review: null } : q.state === 'conferidas' ? { review: { isNot: null } } : {}),
    }
    const [total, audits] = await Promise.all([
      prisma.photoAudit.count({ where }),
      prisma.photoAudit.findMany({ where, include: vendorAuditInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return { total, page: q.page, pageSize: q.pageSize, items: audits.map(serializeVendorAudit) }
  })

  app.post('/vendor-audits/:id/review', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(
      z
        .object({ verdict: z.enum(ReviewVerdict), comment: z.string().trim().max(1000).optional() })
        .refine((b) => b.verdict === 'CORRETA' || (b.comment?.length ?? 0) >= 5, {
          message: 'explique ao vendedor o que estava errado (mínimo 5 caracteres)',
          path: ['comment'],
        }),
      req.body,
    )
    const audit = await prisma.photoAudit.findUnique({ where: { id }, include: { auditor: true } })
    if (!audit) throw notFound('Auditoria')
    if (audit.auditor.role !== 'VENDEDOR') throw conflict('Só auditorias de vendedores são conferidas.')
    if (req.user.role !== 'ADMIN' && audit.auditor.supervisorId !== req.user.sub) throw forbidden('Este vendedor não pertence à sua equipe.')

    await prisma.auditReview.upsert({
      where: { auditId: id },
      create: { auditId: id, supervisorId: req.user.sub, verdict: body.verdict, comment: body.comment },
      update: { supervisorId: req.user.sub, verdict: body.verdict, comment: body.comment },
    })
    return serializeVendorAudit(await prisma.photoAudit.findUniqueOrThrow({ where: { id }, include: vendorAuditInclude }))
  })
}
