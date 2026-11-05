import type { AuthUser } from '../auth'
import { isUniqueViolation, prisma } from '../db'
import { addDays, fromDbDate, toDbDate, todayIn } from '../lib/dates'
import { badRequest, conflict, notFound } from '../lib/errors'
import { fallsOn, routeRule } from './route-frequency'
import { promotorScope } from './scope'
import { lockPromotorDay, planRouteDay, syncTodayWithRoute, type TodayRouteUpdate } from './workdays'

/** Até quantos dias à frente dá para tirar um cliente de uma data do roteiro. */
export const SKIP_DAYS_AHEAD = 366

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

export const serializeSkip = (s: { id: string; clientId: string; date: Date }) => ({ id: s.id, clientId: s.clientId, date: fromDbDate(s.date) })

async function findPromotor(user: AuthUser, promotorId: string) {
  const promotor = await prisma.user.findFirst({ where: { id: promotorId, ...promotorScope(user) }, select: { id: true } })
  if (!promotor) throw notFound('Promotor')
  return promotor
}

/** Datas puladas de hoje em diante de um promotor. */
export async function listRouteSkips(promotorId: string) {
  const list = await prisma.routeSkip.findMany({ where: { promotorId, date: { gte: toDbDate(todayIn()) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] })
  return list.map(serializeSkip)
}

/**
 * Tira o cliente do roteiro fixo numa única data; nas outras ele continua. Sendo hoje, o cliente sai também do dia
 * do promotor (syncTodayWithRoute), desde que a visita ainda esteja pendente.
 */
export async function skipRouteDate(user: AuthUser, promotorId: string, input: { clientId: string; date: string }): Promise<{ skip: ReturnType<typeof serializeSkip>; today: TodayRouteUpdate | null }> {
  await findPromotor(user, promotorId)
  const today = todayIn()
  if (input.date < today) throw badRequest('Escolha hoje ou um dia futuro.')
  if (input.date > addDays(today, SKIP_DAYS_AHEAD)) throw badRequest('Escolha uma data em até um ano.')
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true } })
  if (!client) throw notFound('Cliente')
  const when = input.date === today ? 'hoje' : `em ${shortDate(input.date)}`
  const items = await prisma.routeItem.findMany({ where: { promotorId, clientId: client.id } })
  if (!items.some((item) => fallsOn(routeRule(item), input.date))) {
    throw badRequest(`${client.name} não está no roteiro do promotor ${when}.`, 'CLIENTE_FORA_DO_ROTEIRO')
  }

  const day = toDbDate(input.date)
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockPromotorDay(tx, promotorId)
        const isToday = input.date === today
        if (isToday) {
          const workDay = await tx.workDay.findUnique({ where: { promotorId_date: { promotorId, date: day } } })
          if (workDay?.closedAt || workDay?.endedAt) throw conflict('O roteiro de hoje já foi encerrado pelo promotor.', 'ROTEIRO_ENCERRADO')
        }
        const before = isToday ? await planRouteDay(tx, promotorId, today) : []
        const skip = await tx.routeSkip.create({ data: { promotorId, clientId: client.id, date: day, createdById: user.sub } })
        const update = isToday ? await syncTodayWithRoute(tx, promotorId, before) : null
        // Já atendido, justificado, em atendimento ou visita pontual: continua no dia, então não faz sentido pular
        if (update?.kept.some((c) => c.id === client.id)) {
          throw conflict(`${client.name} continua no dia de hoje: já foi atendido, justificado, está em atendimento ou é visita pontual.`, 'CLIENTE_JA_ATENDIDO')
        }
        return { skip: serializeSkip(skip), today: update }
      },
      { timeout: 30_000 },
    )
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`${client.name} já foi tirado do roteiro ${when}.`, 'JA_RETIRADO')
    throw error
  }
}

/** Desfaz a data pulada: o cliente volta ao roteiro nela. Sendo hoje, volta também ao dia do promotor. */
export async function undoRouteSkip(user: AuthUser, promotorId: string, skipId: string): Promise<{ today: TodayRouteUpdate | null }> {
  await findPromotor(user, promotorId)
  const skip = await prisma.routeSkip.findFirst({ where: { id: skipId, promotorId } })
  if (!skip) throw notFound('Data pulada')
  const today = todayIn()
  const date = fromDbDate(skip.date)
  if (date < today) throw conflict('Esta data já passou.', 'FORA_DO_DIA')
  return prisma.$transaction(
    async (tx) => {
      await lockPromotorDay(tx, promotorId)
      const before = date === today ? await planRouteDay(tx, promotorId, today) : []
      await tx.routeSkip.deleteMany({ where: { id: skip.id } })
      return { today: date === today ? await syncTodayWithRoute(tx, promotorId, before) : null }
    },
    { timeout: 30_000 },
  )
}
