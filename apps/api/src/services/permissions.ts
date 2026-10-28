import { z } from 'zod'
import { prisma, Prisma, type Client, type Visit } from '../db'
import type { AuthUser } from '../auth'
import { fromDbDate, toDbDate, todayIn } from '../lib/dates'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { parse } from '../lib/validate'

/**
 * Tipos de liberação que o supervisor concede ao promotor.
 *
 * Para criar um tipo novo, acrescente um item em `permissionTypes`:
 *  - `validate` confere se o pedido ainda faz sentido (roda ao pedir e de novo ao aprovar)
 *    e devolve o payload que será gravado (pode enriquecer com nomes para exibição);
 *  - `apply` executa o efeito da liberação dentro da transação da aprovação.
 */
type Tx = Prisma.TransactionClient
type VisitWithClient = Visit & { client: Client }
type Ctx = { tx: Tx; promotorId: string; visit: VisitWithClient | null; payload: any; date: string }

type PermissionType = {
  type: string
  label: string
  description: string
  needsVisit: boolean
  payloadSchema?: z.ZodType
  validate: (ctx: Ctx) => Promise<Record<string, unknown> | undefined>
  apply: (ctx: Ctx) => Promise<void>
}

async function pendingVisitsOfDay(tx: Tx, promotorId: string, date: string) {
  return tx.visit.findMany({
    where: { promotorId, date: toDbDate(date), status: 'PENDENTE' },
    include: { client: true },
    orderBy: { position: 'asc' },
  })
}

export const permissionTypes: PermissionType[] = [
  {
    type: 'CHECKIN_FORA_CERCA',
    label: 'Check-in fora da cerca eletrônica',
    description: 'Permite o check-in neste cliente mesmo fora do raio permitido.',
    needsVisit: true,
    async validate({ visit }) {
      if (visit!.status !== 'PENDENTE') throw conflict('A visita não está mais pendente.')
      if (visit!.geofenceWaived) throw conflict('Esta visita já está liberada da cerca eletrônica.')
      return undefined
    },
    async apply({ tx, visit }) {
      await tx.visit.update({ where: { id: visit!.id }, data: { geofenceWaived: true } })
    },
  },
  {
    type: 'DISPENSA_FOTOS',
    label: 'Liberar sem fotos obrigatórias',
    description: 'Permite finalizar o atendimento sem as fotos obrigatórias.',
    needsVisit: true,
    async validate({ visit }) {
      if (visit!.status !== 'PENDENTE' && visit!.status !== 'EM_ATENDIMENTO') throw conflict('A visita já foi finalizada.')
      if (visit!.photosWaived) throw conflict('Esta visita já está dispensada das fotos.')
      return undefined
    },
    async apply({ tx, visit }) {
      await tx.visit.update({ where: { id: visit!.id }, data: { photosWaived: true } })
    },
  },
  {
    type: 'ALTERAR_ORDEM',
    label: 'Alterar ordem de atendimento',
    description: 'Muda a sequência dos clientes pendentes do dia (ex.: inverter dois clientes).',
    needsVisit: false,
    payloadSchema: z.object({ order: z.array(z.string()).min(2, 'informe ao menos dois clientes') }),
    async validate({ tx, promotorId, date, payload }) {
      const pending = await pendingVisitsOfDay(tx, promotorId, date)
      const current = new Set(pending.map((v) => v.id))
      const proposed: string[] = payload.order
      if (proposed.length !== current.size || new Set(proposed).size !== proposed.length || proposed.some((id) => !current.has(id))) {
        throw conflict('O roteiro mudou desde o pedido. Peça a alteração de ordem novamente.', 'ROTEIRO_MUDOU')
      }
      const byId = new Map(pending.map((v) => [v.id, v]))
      return {
        order: proposed,
        from: pending.map((v) => v.client.name),
        to: proposed.map((id) => byId.get(id)!.client.name),
      }
    },
    async apply({ tx, promotorId, date, payload }) {
      const pending = await pendingVisitsOfDay(tx, promotorId, date)
      const slots = pending.map((v) => v.position).sort((a, b) => a - b)
      const order: string[] = payload.order
      for (const [i, id] of order.entries()) {
        await tx.visit.update({ where: { id }, data: { position: slots[i] } })
      }
    },
  },
  {
    type: 'SUBSTITUIR_CLIENTE',
    label: 'Substituir cliente do roteiro',
    description: 'Troca o cliente desta visita por outro cliente.',
    needsVisit: true,
    payloadSchema: z.object({ clientId: z.string().min(1, 'informe o cliente substituto') }),
    async validate({ tx, visit, payload }) {
      if (visit!.status !== 'PENDENTE') throw conflict('A visita não está mais pendente.')
      if (payload.clientId === visit!.clientId) throw badRequest('Escolha um cliente diferente do atual.')
      const client = await tx.client.findUnique({ where: { id: payload.clientId } })
      if (!client || !client.active) throw notFound('Cliente substituto')
      return { clientId: client.id, clientName: client.name, replacedClientName: visit!.client.name }
    },
    async apply({ tx, visit, payload }) {
      await tx.visit.update({ where: { id: visit!.id }, data: { status: 'CANCELADA' } })
      await tx.visit.create({
        data: {
          workDayId: visit!.workDayId,
          promotorId: visit!.promotorId,
          clientId: payload.clientId,
          date: visit!.date,
          position: visit!.position,
          origin: 'SUBSTITUICAO',
          replacesVisitId: visit!.id,
        },
      })
    },
  },
]

export function getPermissionType(type: string) {
  const def = permissionTypes.find((p) => p.type === type)
  if (!def) throw badRequest(`Tipo de liberação desconhecido: ${type}`)
  return def
}

export function listPermissionTypes() {
  return permissionTypes.map(({ type, label, description, needsVisit }) => ({ type, label, description, needsVisit }))
}

/** Supervisor só decide sobre promotores da própria equipe; admin decide sobre todos. */
async function assertCanManage(user: AuthUser, promotorId: string) {
  if (user.role === 'ADMIN') return
  if (user.role !== 'SUPERVISOR') throw forbidden()
  const promotor = await prisma.user.findUnique({ where: { id: promotorId }, select: { supervisorId: true } })
  if (promotor?.supervisorId !== user.sub) throw forbidden('Este promotor não pertence à sua equipe.')
}

type CreateInput = {
  promotorId: string
  type: string
  visitId?: string
  payload?: unknown
  reason?: string
  latitude?: number
  longitude?: number
}

/**
 * Cria um pedido de liberação. Com `grant`, o supervisor libera direto (o pedido já nasce aprovado).
 */
export async function createPermissionRequest(user: AuthUser, input: CreateInput, grant?: { note?: string }) {
  const def = getPermissionType(input.type)
  if (grant) await assertCanManage(user, input.promotorId)
  const payload = def.payloadSchema ? parse(def.payloadSchema, input.payload) : undefined
  if (def.needsVisit && !input.visitId) throw badRequest('Informe a visita para este tipo de liberação.')

  const visit = input.visitId ? await prisma.visit.findUnique({ where: { id: input.visitId }, include: { client: true } }) : null
  if (input.visitId && (!visit || visit.promotorId !== input.promotorId)) throw notFound('Visita')
  const date = visit ? fromDbDate(visit.date) : todayIn()
  if (date !== todayIn()) throw conflict('Só é possível liberar visitas do dia de hoje.', 'FORA_DO_DIA')

  return prisma.$transaction(async (tx) => {
    if (!grant) {
      const duplicate = await tx.permissionRequest.findFirst({
        where: { promotorId: input.promotorId, type: def.type, visitId: input.visitId ?? null, status: 'PENDENTE' },
      })
      if (duplicate) throw conflict('Já existe um pedido igual aguardando o supervisor.', 'PEDIDO_DUPLICADO')
    }
    const ctx: Ctx = { tx, promotorId: input.promotorId, visit, payload, date }
    const stored = await def.validate(ctx)
    const now = new Date()
    const request = await tx.permissionRequest.create({
      data: {
        type: def.type,
        date: toDbDate(date),
        promotorId: input.promotorId,
        visitId: input.visitId,
        payload: stored as Prisma.InputJsonValue | undefined,
        reason: input.reason,
        latitude: input.latitude,
        longitude: input.longitude,
        createdById: user.sub,
        ...(grant ? { status: 'APROVADA' as const, decidedById: user.sub, decidedAt: now, decisionNote: grant.note } : {}),
      },
    })
    if (grant) await def.apply({ ...ctx, payload: stored ?? payload })
    return request
  })
}

export async function decidePermissionRequest(user: AuthUser, requestId: string, approve: boolean, note?: string) {
  const request = await prisma.permissionRequest.findUnique({ where: { id: requestId } })
  if (!request) throw notFound('Pedido de liberação')
  await assertCanManage(user, request.promotorId)
  if (request.status !== 'PENDENTE') throw conflict('Este pedido já foi decidido.', 'JA_DECIDIDO')

  const decided = { decidedById: user.sub, decidedAt: new Date(), decisionNote: note }
  if (!approve) {
    return prisma.permissionRequest.update({ where: { id: requestId }, data: { status: 'NEGADA', ...decided } })
  }

  const def = getPermissionType(request.type)
  return prisma.$transaction(async (tx) => {
    const visit = request.visitId ? await tx.visit.findUnique({ where: { id: request.visitId }, include: { client: true } }) : null
    if (def.needsVisit && !visit) throw conflict('A visita deste pedido não existe mais.')
    const ctx: Ctx = { tx, promotorId: request.promotorId, visit, payload: request.payload, date: fromDbDate(request.date) }
    if (ctx.date !== todayIn()) throw conflict('Este pedido é de outro dia e expirou.', 'FORA_DO_DIA')
    const stored = await def.validate(ctx)
    await def.apply({ ...ctx, payload: stored ?? request.payload })
    return tx.permissionRequest.update({ where: { id: requestId }, data: { status: 'APROVADA', ...decided } })
  })
}

export async function cancelPermissionRequest(promotorId: string, requestId: string) {
  const request = await prisma.permissionRequest.findUnique({ where: { id: requestId } })
  if (!request || request.promotorId !== promotorId) throw notFound('Pedido de liberação')
  if (request.status !== 'PENDENTE') throw conflict('Este pedido já foi decidido.', 'JA_DECIDIDO')
  return prisma.permissionRequest.update({ where: { id: requestId }, data: { status: 'CANCELADA' } })
}

export const requestInclude = {
  promotor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  decidedBy: { select: { id: true, name: true } },
  visit: { select: { id: true, position: true, status: true, client: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.PermissionRequestInclude

type RequestWithRelations = Prisma.PermissionRequestGetPayload<{ include: typeof requestInclude }>

export function serializeRequest(r: RequestWithRelations) {
  return {
    id: r.id,
    type: r.type,
    typeLabel: permissionTypes.find((p) => p.type === r.type)?.label ?? r.type,
    status: r.status,
    date: fromDbDate(r.date),
    promotor: r.promotor,
    visit: r.visit,
    payload: r.payload,
    reason: r.reason,
    latitude: r.latitude,
    longitude: r.longitude,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
  }
}
