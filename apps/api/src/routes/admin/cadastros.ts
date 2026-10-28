import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, type AuthUser } from '../../auth'
import { isUniqueViolation, prisma, Prisma, Role, TaskRecurrence, VisitModule } from '../../db'
import { cityKey, zCity, zUf } from '../../lib/cities'
import { fromDbDate, toDbDate } from '../../lib/dates'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { parse, zDate, zId, zIdParam, zLat, zLng, zPage, zQueryBool } from '../../lib/validate'
import { clientMatcher, clientSearch, located, unlocated, withCityKey } from '../../services/clients'
import { listPermissionTypes } from '../../services/permissions'
import { frequencyColumns, serializeFrequency, zFrequency } from '../../services/route-frequency'
import { distanceMatrix } from '../../services/routing'
import { DEFAULT_MODULES, zModules } from '../../services/visit-structure'
import { areaWhere, assertAdmin, clientScope, inAreas, loadAreas, promotorScope } from '../../services/scope'
import { serializeClient, serializeUser } from '../../services/serializers'
import { photoTypeLabels } from '../../services/settings'

const userSelect = {
  id: true,
  name: true,
  login: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  supervisorId: true,
  createdAt: true,
  areas: { select: { state: true, city: true }, orderBy: [{ state: 'asc' }, { city: 'asc' }] },
} satisfies Prisma.UserSelect

const zLogin = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'use de 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado')

/** Cidade atendida; sem cidade = a UF inteira. */
const zArea = z.object({ state: zUf, city: zCity.nullish() })

const userCreate = z.object({
  name: z.string().trim().min(2).max(120),
  login: zLogin,
  password: z.string().min(6, 'a senha precisa ter ao menos 6 caracteres'),
  role: z.enum(Role),
  email: z.email().nullish(),
  phone: z.string().trim().max(30).nullish(),
  supervisorId: zId.nullish(),
  areas: z.array(zArea).max(200).optional(),
})
const userUpdate = userCreate.partial().extend({ active: z.boolean().optional() })

/** Sem repetição; a UF inteira cobre as cidades dela. */
function normalizeAreas(areas: z.infer<typeof zArea>[]) {
  const wholeUf = new Set(areas.filter((a) => !a.city).map((a) => a.state))
  const seen = new Set<string>()
  return areas.flatMap((a) => {
    const key = `${a.state}|${a.city ? cityKey(a.city) : ''}`
    if ((a.city && wholeUf.has(a.state)) || seen.has(key)) return []
    seen.add(key)
    return [{ state: a.state, city: a.city ?? null }]
  })
}

/** Cadastro do cliente: nome fantasia, razão social, cidade, UF e localização. */
const clientFields = {
  name: z.string().trim().min(2, 'informe o nome fantasia').max(200),
  legalName: z.string().trim().max(200).nullish(),
  city: zCity,
  state: zUf,
  latitude: zLat.optional(),
  longitude: zLng.optional(),
  active: z.boolean().optional(),
}

function assertCoordinates(body: { latitude?: number | null; longitude?: number | null }) {
  if ((body.latitude == null) !== (body.longitude == null)) throw badRequest('Informe a latitude e a longitude juntas.')
}

/** Linha da planilha de clientes. Coordenadas vazias mantêm as atuais. */
const importRow = z.object({
  line: z.number().int().optional(),
  id: zId.nullish(),
  name: z.string().trim().max(200).nullish(),
  legalName: z.string().trim().max(200).nullish(),
  city: zCity.nullish(),
  state: zUf.nullish(),
  latitude: zLat.nullish(),
  longitude: zLng.nullish(),
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

/** Promotor, vendedor e supervisor só veem clientes das suas cidades: sem nenhuma, não veriam nenhum. */
function assertAreas(role: Role, areas: unknown[]) {
  if (role !== 'ADMIN' && areas.length === 0) throw badRequest('Informe ao menos uma cidade (ou a UF inteira) atendida pelo usuário.', 'CIDADE_OBRIGATORIA')
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
    const { password, areas: input, ...body } = parse(userCreate, req.body)
    await assertSupervisor(body.supervisorId)
    const areas = body.role === 'ADMIN' ? [] : normalizeAreas(input ?? [])
    assertAreas(body.role, areas)
    try {
      const user = await prisma.user.create({
        data: { ...body, passwordHash: await bcrypt.hash(password, 10), areas: { create: areas } },
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
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true, areas: { select: { state: true, city: true } } } })
    if (!current) throw notFound('Usuário')
    const { password, areas: input, ...data } = body
    const role = data.role ?? current.role
    const areas = role === 'ADMIN' ? [] : input ? normalizeAreas(input) : current.areas
    assertAreas(role, areas)
    try {
      const user = await prisma.user.update({
        where: { id },
        data: {
          ...data,
          ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
          ...(input || role === 'ADMIN' ? { areas: { deleteMany: {}, create: areas } } : {}),
        },
        select: userSelect,
      })
      return serializeUser(user)
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um usuário com este login.')
      throw e
    }
  })

  // ---------------- Clientes ----------------
  /** Cidades com clientes cadastrados (para escolher as cidades dos usuários e filtrar a lista). */
  app.get('/client-cities', async (req) => {
    const groups = await prisma.client.groupBy({
      by: ['state', 'cityKey', 'city'],
      where: { AND: [await clientScope(req.user), { state: { not: null }, cityKey: { not: null } }] },
      _count: { _all: true },
    })
    // Grafias diferentes da mesma cidade ("Vitória" e "VITORIA") viram uma só, com a grafia mais usada
    const cities = new Map<string, { state: string; city: string; clients: number; top: number }>()
    for (const g of groups) {
      const key = `${g.state}|${g.cityKey}`
      const entry = cities.get(key) ?? { state: g.state!, city: g.city!, clients: 0, top: 0 }
      entry.clients += g._count._all
      if (g._count._all > entry.top) Object.assign(entry, { city: g.city!, top: g._count._all })
      cities.set(key, entry)
    }
    return [...cities.values()]
      .map(({ state, city, clients }) => ({ state, city, clients }))
      .sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city, 'pt-BR'))
  })

  const clientQuery = z.object({
    search: z.string().trim().optional(),
    state: zUf.optional(),
    city: zCity.optional(),
    /** true: só com localização; false: só sem localização */
    located: zQueryBool.optional(),
    /** Só os clientes das cidades deste promotor (roteiro) */
    promotorId: zId.optional(),
    active: zQueryBool.optional(),
  })

  const clientWhere = async (user: AuthUser, q: z.infer<typeof clientQuery>): Promise<Prisma.ClientWhereInput> => {
    let promotorArea: Prisma.ClientWhereInput = {}
    if (q.promotorId) {
      const promotor = await prisma.user.findFirst({ where: { id: q.promotorId, ...promotorScope(user) }, select: { id: true } })
      if (!promotor) throw notFound('Promotor')
      promotorArea = areaWhere(await loadAreas(promotor.id))
    }
    return {
      AND: [
        await clientScope(user),
        promotorArea,
        q.state ? { state: q.state } : {},
        q.city ? { cityKey: cityKey(q.city) } : {},
        q.located === true ? located : q.located === false ? unlocated : {},
        q.active !== undefined ? { active: q.active } : {},
        q.search ? clientSearch(q.search) : {},
      ],
    }
  }

  app.get('/clients', async (req) => {
    const q = parse(clientQuery.extend(zPage), req.query)
    const where = await clientWhere(req.user, q)
    const [total, missingLocation, clients] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.count({ where: { AND: [await clientScope(req.user), unlocated] } }),
      prisma.client.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return { total, page: q.page, pageSize: q.pageSize, missingLocation, items: clients.map(serializeClient) }
  })

  /** Todos os clientes do filtro, para baixar a planilha (e preencher a localização). */
  app.get('/clients/export', async (req) => {
    const where = await clientWhere(req.user, parse(clientQuery, req.query))
    const clients = await prisma.client.findMany({ where, orderBy: [{ state: 'asc' }, { city: 'asc' }, { name: 'asc' }] })
    return clients.map(serializeClient)
  })

  app.post('/clients', async (req) => {
    const body = parse(z.object(clientFields), req.body)
    assertCoordinates(body)
    return serializeClient(await prisma.client.create({ data: withCityKey(body) }))
  })

  app.patch('/clients/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(z.object(clientFields).partial(), req.body)
    assertCoordinates(body)
    const client = await prisma.client.findFirst({ where: { AND: [{ id }, await clientScope(req.user)] }, select: { id: true } })
    if (!client) throw notFound('Cliente')
    return serializeClient(await prisma.client.update({ where: { id }, data: withCityKey(body) }))
  })

  /**
   * Importação da planilha de clientes. A linha com id (planilha baixada do painel) altera aquele cliente; sem id,
   * o cliente é procurado pelo nome fantasia (ou razão social) na cidade e UF, e é cadastrado se não existir.
   * Latitude e longitude vazias mantêm a localização atual.
   */
  app.post('/clients/import', async (req) => {
    assertAdmin(req.user)
    const body = parse(z.object({ clients: z.array(importRow).min(1).max(5000) }), req.body)
    const matcher = await clientMatcher()
    let created = 0
    let updated = 0
    let withLocation = 0
    const problems: { line: number; message: string }[] = []
    for (const [i, row] of body.clients.entries()) {
      const line = row.line ?? i + 2
      if ((row.latitude == null) !== (row.longitude == null)) {
        problems.push({ line, message: 'latitude e longitude precisam vir juntas' })
        continue
      }
      const coords = row.latitude != null && row.longitude != null ? { latitude: row.latitude, longitude: row.longitude } : {}
      const found = matcher.match(row)
      if ('error' in found && found.error !== 'NAO_ENCONTRADO') {
        problems.push({
          line,
          message:
            found.error === 'AMBIGUO'
              ? `há mais de um cliente "${row.name || row.legalName}" em ${row.city} - ${row.state}: use a coluna id (baixe a planilha do painel)`
              : 'informe o id ou o nome fantasia (ou a razão social), a cidade e a UF',
        })
        continue
      }
      if ('error' in found && row.id) {
        problems.push({ line, message: `cliente de id ${row.id} não existe` })
        continue
      }
      const names = { ...(row.name ? { name: row.name } : {}), ...(row.legalName ? { legalName: row.legalName } : {}) }
      const place = { ...(row.city ? { city: row.city } : {}), ...(row.state ? { state: row.state } : {}) }
      const saved =
        'client' in found
          ? await prisma.client.update({ where: { id: found.client.id }, data: withCityKey({ ...names, ...place, ...coords }) })
          : await prisma.client.create({ data: withCityKey({ name: (row.name || row.legalName)!, legalName: row.legalName || null, city: row.city!, state: row.state!, ...coords }) })
      matcher.add(saved)
      if ('client' in found) updated++
      else created++
      if (coords.latitude != null) withLocation++
    }
    return { created, updated, located: withLocation, problems }
  })

  // ---------------- Roteiro fixo ----------------
  app.get('/routes/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const promotor = await prisma.user.findFirst({ where: { id, ...promotorScope(req.user) }, select: { id: true, name: true } })
    if (!promotor) throw notFound('Promotor')
    const [items, areas] = await Promise.all([
      prisma.routeItem.findMany({ where: { promotorId: id }, include: { client: true }, orderBy: [{ weekday: 'asc' }, { position: 'asc' }] }),
      loadAreas(id),
    ])
    return {
      promotor: { ...promotor, areas },
      weekdays: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        clients: items
          .filter((i) => i.weekday === weekday)
          .map((i) => ({ ...serializeClient(i.client), frequency: serializeFrequency(i), modules: i.modules, outsideArea: !inAreas(i.client, areas) })),
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
    const [clients, areas] = await Promise.all([
      prisma.client.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, state: true, cityKey: true, latitude: true, longitude: true } }),
      loadAreas(promotorId),
    ])
    if (clients.length !== ids.size) throw badRequest('Um ou mais clientes não existem.')
    const names = (list: typeof clients) => list.map((c) => c.name).join(', ')
    const unlocated = clients.filter((c) => c.latitude == null || c.longitude == null)
    if (unlocated.length) throw badRequest(`Sem localização cadastrada: ${names(unlocated)}. Preencha a latitude e a longitude em Clientes.`, 'CLIENTE_SEM_LOCALIZACAO')
    const outside = clients.filter((c) => !inAreas(c, areas))
    if (outside.length) throw badRequest(`Fora das cidades do promotor: ${names(outside)}. Tire do roteiro ou inclua a cidade no cadastro do promotor.`, 'CLIENTE_FORA_DA_AREA')
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
    const clients = (await prisma.client.findMany({ where: { id: { in: [...new Set(body.clientIds)] }, ...located }, select: { id: true, latitude: true, longitude: true } })).map(
      (c) => ({ id: c.id, latitude: c.latitude!, longitude: c.longitude! }),
    )
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
        client: { select: { id: true, name: true, city: true } },
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
