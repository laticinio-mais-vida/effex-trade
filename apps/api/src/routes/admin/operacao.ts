import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, type AuthUser } from '../../auth'
import { PhotoType, prisma, Prisma, RequestStatus } from '../../db'
import { addDays, fromDbDate, localDayRange, toDbDate, todayIn } from '../../lib/dates'
import { badRequest, forbidden, notFound } from '../../lib/errors'
import { parse, zDate, zId, zIdParam, zPage, zQueryBool } from '../../lib/validate'
import { ALERT_LUNCH, alertInclude, checkLunchAlerts, serializeAlert } from '../../services/alerts'
import { auditErrorsData, auditErrorsPdf } from '../../services/audit-errors'
import { requestInclude, serializeRequest } from '../../services/permissions'
import { visitReport } from '../../services/reports'
import { assertAdmin, promotorScope } from '../../services/scope'
import { serializePhoto } from '../../services/serializers'
import {
  clearPromotorSettings,
  defaultSettings,
  getSettings,
  listPromotorOverrides,
  settingsMeta,
  updatePromotorSettings,
  updateSettings,
} from '../../services/settings'
import { ensureWorkDaysForAll } from '../../services/workdays'

async function scopedPromotorIds(user: AuthUser, promotorId?: string) {
  const promotores = await prisma.user.findMany({ where: { ...promotorScope(user), ...(promotorId ? { id: promotorId } : {}) }, select: { id: true } })
  if (promotorId && promotores.length === 0) throw notFound('Promotor')
  return promotores.map((p) => p.id)
}

function rangeQuery(defaultDays: number) {
  return {
    from: zDate.optional(),
    to: zDate.optional(),
    resolve(q: { from?: string; to?: string }) {
      const to = q.to ?? todayIn()
      const from = q.from ?? addDays(to, -defaultDays)
      if (from > to) throw badRequest('A data inicial precisa ser anterior à final.')
      return { from, to }
    },
  }
}

export async function adminOperacaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('ADMIN', 'SUPERVISOR'))

  // ---------------- Regras ----------------
  /**
   * Regras gerais, exceções por promotor e, para o atalho "promotores de um vendedor", quais vendedores
   * cada promotor atende (pelos clientes do roteiro fixo).
   */
  app.get('/settings', async () => {
    const routes = await prisma.routeItem.findMany({ select: { promotorId: true, client: { select: { sellerId: true } } } })
    const promotorSellers: Record<string, string[]> = {}
    for (const r of routes) {
      if (!r.client.sellerId) continue
      const list = (promotorSellers[r.promotorId] ??= [])
      if (!list.includes(r.client.sellerId)) list.push(r.client.sellerId)
    }
    return { values: await getSettings(), defaults: defaultSettings, meta: settingsMeta, overrides: await listPromotorOverrides(), promotorSellers }
  })

  /** Sem promotorIds altera a regra geral; com promotorIds grava exceção só para esses promotores. */
  app.put('/settings', async (req) => {
    assertAdmin(req.user)
    const body = req.body as Record<string, unknown> | null
    if (body && typeof body === 'object' && 'values' in body) {
      const q = parse(z.object({ values: z.record(z.string(), z.unknown()), promotorIds: z.array(zId).max(1000).default([]) }), body)
      if (q.promotorIds.length > 0) {
        await updatePromotorSettings(q.promotorIds, q.values)
        return { values: await getSettings(), overrides: await listPromotorOverrides() }
      }
      return { values: await updateSettings(q.values), overrides: await listPromotorOverrides() }
    }
    return { values: await updateSettings(body), overrides: await listPromotorOverrides() }
  })

  /** Remove exceções: o promotor volta à regra geral (todas as regras ou só as informadas). */
  app.post('/settings/overrides/clear', async (req) => {
    assertAdmin(req.user)
    const body = parse(z.object({ promotorIds: z.array(zId).min(1).max(1000), keys: z.array(z.string()).optional() }), req.body)
    await clearPromotorSettings(body.promotorIds, body.keys)
    return { overrides: await listPromotorOverrides() }
  })

  // ---------------- Painel inicial ----------------
  app.get('/dashboard', async (req) => {
    const today = todayIn()
    await ensureWorkDaysForAll(today)
    await checkLunchAlerts()
    const ids = await scopedPromotorIds(req.user)
    const alerts = await prisma.alert.findMany({ where: { acknowledgedAt: null, promotorId: { in: ids } }, include: alertInclude, orderBy: { createdAt: 'desc' } })
    const [byStatus, pendingRequests, photosToday, photosUnreviewed, onlineNow] = await Promise.all([
      prisma.visit.groupBy({ by: ['status'], where: { date: toDbDate(today), promotorId: { in: ids }, status: { not: 'CANCELADA' } }, _count: true }),
      prisma.permissionRequest.count({ where: { status: 'PENDENTE', date: toDbDate(today), promotorId: { in: ids } } }),
      prisma.photo.count({ where: { visit: { date: toDbDate(today), promotorId: { in: ids } } } }),
      prisma.photo.count({ where: { score: null, visit: { date: { gte: toDbDate(addDays(today, -7)) }, promotorId: { in: ids } } } }),
      prisma.locationPing.groupBy({ by: ['promotorId'], where: { promotorId: { in: ids }, recordedAt: { gte: new Date(Date.now() - 15 * 60_000) } } }),
    ])
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0
    return {
      date: today,
      promotores: ids.length,
      online: onlineNow.length,
      visits: {
        total: byStatus.reduce((s, b) => s + b._count, 0),
        done: count('CONCLUIDA'),
        justified: count('JUSTIFICADA'),
        pending: count('PENDENTE'),
        inProgress: count('EM_ATENDIMENTO'),
      },
      pendingRequests,
      photosToday,
      photosUnreviewed,
      alerts: alerts.map(serializeAlert),
    }
  })

  // ---------------- Mapa ----------------
  app.get('/map', async (req) => {
    const q = parse(z.object({ date: zDate.optional(), promotorId: zId.optional() }), req.query)
    const date = q.date ?? todayIn()
    if (date === todayIn()) await ensureWorkDaysForAll(date)
    const settings = await getSettings()

    const promotores = await prisma.user.findMany({
      where: { ...promotorScope(req.user), active: true, ...(q.promotorId ? { id: q.promotorId } : {}) },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
    })
    const ids = promotores.map((p) => p.id)
    const visits = await prisma.visit.findMany({
      where: { date: toDbDate(date), promotorId: { in: ids }, status: { not: 'CANCELADA' } },
      include: { client: true, justificationReason: true },
      orderBy: [{ promotorId: 'asc' }, { position: 'asc' }],
    })
    const workDays = await prisma.workDay.findMany({ where: { date: toDbDate(date), promotorId: { in: ids } } })
    const lunchLimits = await Promise.all(ids.map(async (id) => (await getSettings(id)).lunchAlertMinutes))
    const { start, end } = localDayRange(date)
    const lastPings = await Promise.all(
      ids.map((id) => prisma.locationPing.findFirst({ where: { promotorId: id, recordedAt: { gte: start, lt: end } }, orderBy: { recordedAt: 'desc' } })),
    )
    const trail = q.promotorId
      ? await prisma.locationPing.findMany({
          where: { promotorId: q.promotorId, recordedAt: { gte: start, lt: end } },
          select: { latitude: true, longitude: true, recordedAt: true },
          orderBy: { recordedAt: 'asc' },
        })
      : []

    return {
      date,
      generatedAt: new Date(),
      refreshSeconds: settings.mapRefreshSeconds,
      promotores: promotores.map((p, i) => {
        const mine = visits.filter((v) => v.promotorId === p.id)
        const current = mine.find((v) => v.status === 'EM_ATENDIMENTO')
        const ping = lastPings[i]
        const wd = workDays.find((w) => w.promotorId === p.id)
        const lunchLimit = lunchLimits[i]!
        return {
          ...p,
          workStart: wd?.startedAt ?? null,
          workEnd: wd?.closedAt ? wd.endedAt : null,
          lunch: wd?.lunchStartedAt
            ? {
                start: wd.lunchStartedAt,
                end: wd.lunchEndedAt,
                // Passou do limite das regras: o supervisor foi alertado
                overdue: lunchLimit > 0 && ((wd.lunchEndedAt ?? new Date()).getTime() - wd.lunchStartedAt.getTime()) / 60_000 >= lunchLimit,
              }
            : null,
          lastPing: ping
            ? { latitude: ping.latitude, longitude: ping.longitude, accuracy: ping.accuracy, battery: ping.battery, mocked: ping.mocked, recordedAt: ping.recordedAt }
            : null,
          currentVisit: current ? { id: current.id, clientName: current.client.name, since: current.checkinAt } : null,
          stats: {
            total: mine.length,
            done: mine.filter((v) => v.status === 'CONCLUIDA').length,
            justified: mine.filter((v) => v.status === 'JUSTIFICADA').length,
            pending: mine.filter((v) => v.status === 'PENDENTE').length,
            inProgress: mine.filter((v) => v.status === 'EM_ATENDIMENTO').length,
          },
        }
      }),
      visits: visits.map((v) => ({
        id: v.id,
        promotorId: v.promotorId,
        position: v.position,
        origin: v.origin,
        status: v.status,
        autoClosed: v.autoClosed,
        checkinAt: v.checkinAt,
        checkoutAt: v.checkoutAt,
        justification: v.justifiedAt ? { reason: v.justificationReason?.label ?? null, text: v.justificationText } : null,
        client: { id: v.client.id, code: v.client.code, name: v.client.name, address: v.client.address, city: v.client.city, latitude: v.client.latitude, longitude: v.client.longitude },
      })),
      trail,
    }
  })

  // ---------------- Relatório de execução ----------------
  app.get('/reports/visits', async (req) => {
    const range = rangeQuery(6)
    const q = parse(z.object({ from: range.from, to: range.to, promotorId: zId.optional() }), req.query)
    const { from, to } = range.resolve(q)
    if (toDbDate(to).getTime() - toDbDate(from).getTime() > 92 * 86_400_000) throw badRequest('Período máximo de 92 dias.')
    return visitReport({ from, to, promotorIds: await scopedPromotorIds(req.user, q.promotorId) })
  })

  // ---------------- Avaliação de fotos ----------------
  app.get('/photos', async (req) => {
    const range = rangeQuery(6)
    const q = parse(
      z.object({
        from: range.from,
        to: range.to,
        promotorId: zId.optional(),
        clientId: zId.optional(),
        type: z.enum(PhotoType).optional(),
        reviewed: zQueryBool.optional(),
        ...zPage,
      }),
      req.query,
    )
    const { from, to } = range.resolve(q)
    const ids = await scopedPromotorIds(req.user, q.promotorId)
    const where: Prisma.PhotoWhereInput = {
      visit: { date: { gte: toDbDate(from), lte: toDbDate(to) }, promotorId: { in: ids }, ...(q.clientId ? { clientId: q.clientId } : {}) },
      ...(q.type ? { type: q.type } : {}),
      ...(q.reviewed === true ? { reviewedAt: { not: null } } : q.reviewed === false ? { reviewedAt: null } : {}),
    }
    const [total, photos] = await Promise.all([
      prisma.photo.count({ where }),
      prisma.photo.findMany({
        where,
        include: {
          visit: { include: { client: { select: { id: true, name: true, code: true, city: true } }, promotor: { select: { id: true, name: true } } } },
          reviewedBy: { select: { id: true, name: true } },
          audits: { include: { auditor: { select: { id: true, name: true, role: true } }, review: true } },
          task: { select: { id: true, title: true } },
          products: { include: { product: true } },
        },
        orderBy: [{ visit: { date: 'desc' } }, { takenAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: photos.map((p) => ({
        ...serializePhoto(p),
        visit: { id: p.visit.id, date: fromDbDate(p.visit.date), status: p.visit.status },
        client: p.visit.client,
        promotor: p.visit.promotor,
        task: p.task,
        reviewedBy: p.reviewedBy,
        audits: p.audits.map((a) => ({
          id: a.id,
          status: a.status,
          justification: a.justification,
          auditor: a.auditor,
          createdAt: a.createdAt,
          review: a.review ? { verdict: a.review.verdict, comment: a.review.comment } : null,
        })),
      })),
    }
  })

  app.patch('/photos/:id/review', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const settings = await getSettings()
    const body = parse(z.object({ score: z.number().int().min(0).max(settings.photoScoreMax).nullable(), notes: z.string().trim().max(2000).nullish() }), req.body)
    const photo = await prisma.photo.findUnique({ where: { id }, include: { visit: { select: { promotorId: true } } } })
    if (!photo) throw notFound('Foto')
    const ids = await scopedPromotorIds(req.user)
    if (!ids.includes(photo.visit.promotorId)) throw forbidden('Esta foto não é de um promotor da sua equipe.')
    const updated = await prisma.photo.update({
      where: { id },
      data: { score: body.score, reviewNotes: body.notes ?? null, reviewedById: req.user.sub, reviewedAt: new Date() },
    })
    return serializePhoto(updated)
  })

  // ---------------- Liberações (histórico) ----------------
  app.get('/requests', async (req) => {
    const range = rangeQuery(6)
    const q = parse(z.object({ from: range.from, to: range.to, promotorId: zId.optional(), status: z.enum(RequestStatus).optional() }), req.query)
    const { from, to } = range.resolve(q)
    const ids = await scopedPromotorIds(req.user, q.promotorId)
    const requests = await prisma.permissionRequest.findMany({
      where: { promotorId: { in: ids }, date: { gte: toDbDate(from), lte: toDbDate(to) }, ...(q.status ? { status: q.status } : {}) },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    return requests.map(serializeRequest)
  })

  // ---------------- Correções de auditoria do vendedor ----------------
  const auditErrorsQuery = (() => {
    const range = rangeQuery(30)
    return { schema: z.object({ vendedorId: zId, from: range.from, to: range.to }), resolve: range.resolve }
  })()

  async function assertVendedorInScope(user: AuthUser, vendedorId: string) {
    if (user.role === 'ADMIN') return
    const v = await prisma.user.findUnique({ where: { id: vendedorId }, select: { supervisorId: true } })
    if (v?.supervisorId !== user.sub) throw forbidden('Este vendedor não pertence à sua equipe.')
  }

  app.get('/audit-errors', async (req) => {
    const q = parse(auditErrorsQuery.schema, req.query)
    await assertVendedorInScope(req.user, q.vendedorId)
    const { from, to } = auditErrorsQuery.resolve(q)
    return auditErrorsData(q.vendedorId, from, to)
  })

  app.get('/audit-errors/pdf', async (req, reply) => {
    const q = parse(auditErrorsQuery.schema, req.query)
    await assertVendedorInScope(req.user, q.vendedorId)
    const { from, to } = auditErrorsQuery.resolve(q)
    const pdf = await auditErrorsPdf(q.vendedorId, from, to)
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="correcoes-auditoria-${from}-a-${to}.pdf"`)
      .send(pdf)
  })
}
