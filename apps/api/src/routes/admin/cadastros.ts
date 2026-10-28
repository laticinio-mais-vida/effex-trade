import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../../auth'
import { isUniqueViolation, prisma, Role, TaskRecurrence, VisitModule } from '../../db'
import { fromDbDate, toDbDate } from '../../lib/dates'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { parse, zDate, zId, zIdParam, zLat, zLng, zPage, zQueryBool } from '../../lib/validate'
import { listPermissionTypes } from '../../services/permissions'
import { frequencyColumns, serializeFrequency, zFrequency } from '../../services/route-frequency'
import { distanceMatrix } from '../../services/routing'
import { DEFAULT_MODULES, zModules } from '../../services/visit-structure'
import { assertAdmin, promotorScope } from '../../services/scope'
import { serializeClient, serializeUser } from '../../services/serializers'
import { photoTypeLabels } from '../../services/settings'

const userSelect = { id: true, name: true, login: true, email: true, phone: true, role: true, active: true, supervisorId: true, createdAt: true } as const

const zLogin = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'use de 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado')

const userCreate = z.object({
  name: z.string().trim().min(2).max(120),
  login: zLogin,
  password: z.string().min(6, 'a senha precisa ter ao menos 6 caracteres'),
  role: z.enum(Role),
  email: z.email().nullish(),
  phone: z.string().trim().max(30).nullish(),
  supervisorId: zId.nullish(),
})
const userUpdate = userCreate.partial().extend({ active: z.boolean().optional() })

const clientBody = z.object({
  code: z.string().trim().max(40).nullish(),
  name: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).nullish(),
  document: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(2).nullish(),
  latitude: zLat,
  longitude: zLng,
  geofenceRadius: z.number().int().min(10).max(5000).nullish(),
  sellerId: zId.nullish(),
  active: z.boolean().optional(),
})

const taskBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).nullish(),
  clientId: zId.nullish(),
  promotorId: zId.nullish(),
  startDate: zDate,
  /** Sem data de fim: vale até ser desativada */
  endDate: zDate.nullish(),
  recurrence: z.enum(TaskRecurrence).default('TODA_VISITA'),
  requiresPhoto: z.boolean().default(true),
  required: z.boolean().default(false),
  active: z.boolean().optional(),
})

async function assertSupervisor(id: string | null | undefined) {
  if (!id) return
  const sup = await prisma.user.findUnique({ where: { id } })
  if (!sup || sup.role !== 'SUPERVISOR') throw badRequest('O supervisor informado não existe ou não tem perfil de supervisor.')
}

async function assertSeller(id: string | null | undefined) {
  if (!id) return
  const seller = await prisma.user.findUnique({ where: { id } })
  if (!seller || seller.role !== 'VENDEDOR') throw badRequest('O vendedor informado não existe ou não tem perfil de vendedor.')
}

export async function adminCadastrosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('ADMIN', 'SUPERVISOR'))

  /** Listas para selects do painel. */
  app.get('/lookups', async () => {
    const [users, reasons] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, supervisorId: true }, orderBy: { name: 'asc' } }),
      prisma.justificationReason.findMany({ orderBy: [{ position: 'asc' }, { label: 'asc' }] }),
    ])
    return {
      promotores: users.filter((u) => u.role === 'PROMOTOR'),
      vendedores: users.filter((u) => u.role === 'VENDEDOR'),
      supervisores: users.filter((u) => u.role === 'SUPERVISOR'),
      reasons,
      permissionTypes: listPermissionTypes(),
      photoTypes: Object.entries(photoTypeLabels).map(([value, label]) => ({ value, label })),
    }
  })

  // ---------------- Usuários ----------------
  app.get('/users', async (req) => {
    const q = parse(z.object({ role: z.enum(Role).optional(), search: z.string().trim().optional(), active: zQueryBool.optional() }), req.query)
    const users = await prisma.user.findMany({
      where: {
        ...(q.role ? { role: q.role } : {}),
        ...(q.active !== undefined ? { active: q.active } : {}),
        ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { login: { contains: q.search.toLowerCase() } }] } : {}),
      },
      select: { ...userSelect, supervisor: { select: { id: true, name: true } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })
    return users.map((u) => ({ ...serializeUser(u), supervisor: u.supervisor }))
  })

  app.post('/users', async (req) => {
    assertAdmin(req.user)
    const body = parse(userCreate, req.body)
    await assertSupervisor(body.supervisorId)
    try {
      const user = await prisma.user.create({
        data: { ...body, password: undefined, passwordHash: await bcrypt.hash(body.password, 10) } as never,
        select: userSelect,
      })
      return serializeUser(user)
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um usuário com este login.')
      throw e
    }
  })

  app.patch('/users/:id', async (req) => {
    assertAdmin(req.user)
    const { id } = parse(zIdParam, req.params)
    const body = parse(userUpdate, req.body)
    await assertSupervisor(body.supervisorId)
    const { password, ...data } = body
    try {
      const user = await prisma.user.update({
        where: { id },
        data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
        select: userSelect,
      })
      return serializeUser(user)
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um usuário com este login.')
      throw e
    }
  })

  // ---------------- Clientes ----------------
  app.get('/clients', async (req) => {
    const q = parse(z.object({ search: z.string().trim().optional(), sellerId: zId.optional(), active: zQueryBool.optional(), ...zPage }), req.query)
    const where = {
      ...(q.sellerId ? { sellerId: q.sellerId } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { tradeName: { contains: q.search, mode: 'insensitive' as const } },
              { code: { contains: q.search } },
              { city: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    const [total, clients] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({ where, include: { seller: { select: { id: true, name: true } } }, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return { total, page: q.page, pageSize: q.pageSize, items: clients.map((c) => ({ ...serializeClient(c), seller: c.seller })) }
  })

  app.post('/clients', async (req) => {
    const body = parse(clientBody, req.body)
    await assertSeller(body.sellerId)
    try {
      return serializeClient(await prisma.client.create({ data: body }))
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um cliente com este código.')
      throw e
    }
  })

  app.patch('/clients/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(clientBody.partial(), req.body)
    await assertSeller(body.sellerId)
    try {
      return serializeClient(await prisma.client.update({ where: { id }, data: body }))
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um cliente com este código.')
      throw e
    }
  })

  /** Importação em lote (planilha convertida no painel). Atualiza pelo código do ERP. */
  app.post('/clients/import', async (req) => {
    const body = parse(z.object({ clients: z.array(clientBody.extend({ code: z.string().trim().min(1).max(40), sellerLogin: z.string().trim().nullish() })).min(1).max(5000) }), req.body)
    const sellers = await prisma.user.findMany({ where: { role: 'VENDEDOR' }, select: { id: true, login: true } })
    const sellerByLogin = new Map(sellers.map((s) => [s.login, s.id]))
    let created = 0
    let updated = 0
    for (const { sellerLogin, ...c } of body.clients) {
      const data = { ...c, sellerId: c.sellerId ?? (sellerLogin ? (sellerByLogin.get(sellerLogin.toLowerCase()) ?? null) : undefined) }
      const existing = await prisma.client.findUnique({ where: { code: c.code }, select: { id: true } })
      if (existing) {
        await prisma.client.update({ where: { id: existing.id }, data })
        updated++
      } else {
        await prisma.client.create({ data })
        created++
      }
    }
    return { created, updated }
  })

  // ---------------- Roteiro fixo ----------------
  app.get('/routes/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const promotor = await prisma.user.findFirst({ where: { id, ...promotorScope(req.user) }, select: { id: true, name: true } })
    if (!promotor) throw notFound('Promotor')
    const items = await prisma.routeItem.findMany({ where: { promotorId: id }, include: { client: true }, orderBy: [{ weekday: 'asc' }, { position: 'asc' }] })
    return {
      promotor,
      weekdays: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        clients: items
          .filter((i) => i.weekday === weekday)
          .map((i) => ({ ...serializeClient(i.client), frequency: serializeFrequency(i), modules: i.modules })),
      })),
    }
  })

  type RouteDayInput = {
    weekday: number
    clientIds?: string[]
    items?: { clientId: string; frequency?: z.infer<typeof zFrequency>; modules?: VisitModule[] }[]
  }

  /** Substitui o roteiro dos dias informados, numa transação só. Sem frequência (ou só clientIds), o cliente entra como semanal. */
  const replaceRouteDays = async (promotorId: string, input: RouteDayInput[]) => {
    const days = input.map((d) => ({
      weekday: d.weekday,
      items: d.items ?? (d.clientIds ?? []).map((clientId) => ({ clientId, frequency: undefined, modules: undefined })),
    }))
    if (days.some((d) => new Set(d.items.map((i) => i.clientId)).size !== d.items.length)) throw badRequest('Cliente repetido no roteiro do mesmo dia.')
    const ids = new Set(days.flatMap((d) => d.items.map((i) => i.clientId)))
    const clients = await prisma.client.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
    if (clients.length !== ids.size) throw badRequest('Um ou mais clientes não existem.')
    const rows = days.map(({ weekday, items }) => ({
      weekday,
      data: items.map(({ clientId, frequency, modules }, i) => ({
        promotorId,
        clientId,
        weekday,
        position: i + 1,
        ...frequencyColumns(weekday, frequency, clients.find((c) => c.id === clientId)!.name),
        modules: modules ?? DEFAULT_MODULES,
      })),
    }))
    await prisma.$transaction(
      rows.flatMap(({ weekday, data }) => [prisma.routeItem.deleteMany({ where: { promotorId, weekday } }), prisma.routeItem.createMany({ data })]),
    )
  }
  const zRouteDay = {
    clientIds: z.array(zId).max(100).optional(),
    items: z.array(z.object({ clientId: zId, frequency: zFrequency.optional(), modules: zModules.optional() })).max(100).optional(),
  }

  app.put('/routes/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(z.object({ days: z.array(z.object({ weekday: z.number().int().min(0).max(6), ...zRouteDay })).min(1).max(7) }), req.body)
    if (new Set(body.days.map((d) => d.weekday)).size !== body.days.length) throw badRequest('Dia da semana repetido.')
    const promotor = await prisma.user.findFirst({ where: { id, ...promotorScope(req.user) } })
    if (!promotor) throw notFound('Promotor')
    await replaceRouteDays(id, body.days)
    return { ok: true, days: body.days.map((d) => ({ weekday: d.weekday, count: (d.items ?? d.clientIds ?? []).length })) }
  })

  app.put('/routes/:id/:weekday', async (req) => {
    const params = parse(z.object({ id: zId, weekday: z.coerce.number().int().min(0).max(6) }), req.params)
    const body = parse(z.object(zRouteDay), req.body)
    const promotor = await prisma.user.findFirst({ where: { id: params.id, ...promotorScope(req.user) } })
    if (!promotor) throw notFound('Promotor')
    await replaceRouteDays(params.id, [{ weekday: params.weekday, ...body }])
    return { ok: true, count: (body.items ?? body.clientIds ?? []).length }
  })

  /** Distâncias entre os clientes de um dia (pelas ruas, se houver OSRM), para mostrar o deslocamento e sugerir a ordem. */
  app.post('/route-distances', async (req) => {
    const body = parse(z.object({ clientIds: z.array(zId).min(1).max(100) }), req.body)
    const clients = await prisma.client.findMany({ where: { id: { in: [...new Set(body.clientIds)] } }, select: { id: true, latitude: true, longitude: true } })
    const { meters, source } = await distanceMatrix(clients)
    return { clientIds: clients.map((c) => c.id), meters: meters.map((row) => row.map(Math.round)), source }
  })

  // ---------------- Motivos de justificativa ----------------
  app.get('/reasons', async () => prisma.justificationReason.findMany({ orderBy: [{ position: 'asc' }, { label: 'asc' }] }))

  app.post('/reasons', async (req) => {
    assertAdmin(req.user)
    const body = parse(z.object({ label: z.string().trim().min(2).max(120), position: z.number().int().default(0) }), req.body)
    return prisma.justificationReason.create({ data: body })
  })

  app.patch('/reasons/:id', async (req) => {
    assertAdmin(req.user)
    const { id } = parse(zIdParam, req.params)
    const body = parse(z.object({ label: z.string().trim().min(2).max(120), position: z.number().int(), active: z.boolean() }).partial(), req.body)
    return prisma.justificationReason.update({ where: { id }, data: body })
  })

  // ---------------- Atividades extras ----------------
  app.get('/tasks', async (req) => {
    const q = parse(z.object({ active: zQueryBool.optional() }), req.query)
    const tasks = await prisma.task.findMany({
      where: q.active !== undefined ? { active: q.active } : {},
      include: {
        client: { select: { id: true, name: true, code: true } },
        promotor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { photos: true, completions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return tasks.map((t) => ({
      ...t,
      startDate: fromDbDate(t.startDate),
      endDate: t.endDate ? fromDbDate(t.endDate) : null,
      photoCount: t._count.photos,
      completionCount: t._count.completions,
    }))
  })

  app.post('/tasks', async (req) => {
    const body = parse(taskBody, req.body)
    if (body.endDate && body.endDate < body.startDate) throw badRequest('A data final precisa ser igual ou posterior à inicial.')
    const task = await prisma.task.create({
      data: { ...body, startDate: toDbDate(body.startDate), endDate: body.endDate ? toDbDate(body.endDate) : null, createdById: req.user.sub },
    })
    return { ...task, startDate: body.startDate, endDate: body.endDate ?? null }
  })

  app.patch('/tasks/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(taskBody.partial(), req.body)
    const current = await prisma.task.findUnique({ where: { id } })
    if (!current) throw notFound('Atividade extra')
    const start = body.startDate ?? fromDbDate(current.startDate)
    const end = body.endDate === undefined ? (current.endDate ? fromDbDate(current.endDate) : null) : body.endDate
    if (end && end < start) throw badRequest('A data final precisa ser igual ou posterior à inicial.')
    const task = await prisma.task.update({
      where: { id },
      data: {
        ...body,
        startDate: body.startDate ? toDbDate(body.startDate) : undefined,
        // null tira a data de fim; ausente mantém a atual
        endDate: body.endDate === undefined ? undefined : body.endDate ? toDbDate(body.endDate) : null,
      },
    })
    return { ...task, startDate: fromDbDate(task.startDate), endDate: task.endDate ? fromDbDate(task.endDate) : null }
  })
}
