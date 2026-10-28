import type { AuthUser } from '../auth'
import { isUniqueViolation, prisma, Prisma, type VisitModule } from '../db'
import { addDays, fromDbDate, toDbDate, todayIn } from '../lib/dates'
import { badRequest, conflict, notFound } from '../lib/errors'
import { assertClientInArea, clientPoint } from './clients'
import { fallsOn, routeRule } from './route-frequency'
import { promotorScope } from './scope'
import { serializeClient } from './serializers'
import { DEFAULT_MODULES, onlyActivities } from './visit-structure'
import { ensureWorkDay } from './workdays'

/** Até quantos dias à frente o supervisor agenda uma visita pontual. */
export const SCHEDULE_DAYS_AHEAD = 30

export const scheduledInclude = {
  client: true,
  createdBy: { select: { id: true, name: true } },
  visit: { select: { id: true, status: true } },
  tasks: { select: { id: true, title: true, requiresPhoto: true } },
} satisfies Prisma.ScheduledVisitInclude

type ScheduledWithRelations = Prisma.ScheduledVisitGetPayload<{ include: typeof scheduledInclude }>

export function serializeScheduled(s: ScheduledWithRelations) {
  return {
    id: s.id,
    date: fromDbDate(s.date),
    note: s.note,
    modules: s.modules,
    /** Atividade escrita pelo supervisor para esta visita */
    activity: s.tasks[0] ?? null,
    client: serializeClient(s.client),
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    visit: s.visit,
  }
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

type ScheduleInput = {
  promotorId: string
  clientId: string
  date: string
  note?: string
  modules?: VisitModule[]
  /** Atividade extra escrita na hora: vale só para esta visita, uma vez, e é obrigatória */
  activity?: { title: string; requiresPhoto: boolean }
}

/**
 * Visita pontual: o supervisor inclui um cliente num único dia do promotor, fora do roteiro fixo, com a
 * estrutura de atendimento escolhida. Se o dia já foi gerado (hoje), a visita entra na hora, no fim da lista
 * e fora da ordem do roteiro; num dia futuro, fica agendada e entra quando o dia for gerado.
 */
export async function scheduleVisit(user: AuthUser, input: ScheduleInput) {
  const promotor = await prisma.user.findFirst({ where: { id: input.promotorId, active: true, ...promotorScope(user) }, select: { id: true, name: true, role: true } })
  if (!promotor) throw notFound('Promotor')
  const today = todayIn()
  if (input.date < today) throw badRequest('Escolha hoje ou um dia futuro.')
  if (input.date > addDays(today, SCHEDULE_DAYS_AHEAD)) throw badRequest(`Agende com até ${SCHEDULE_DAYS_AHEAD} dias de antecedência.`)
  const client = await prisma.client.findUnique({ where: { id: input.clientId } })
  if (!client || !client.active) throw notFound('Cliente')
  // O cliente precisa estar nas cidades de quem agenda e nas do promotor
  await assertClientInArea({ id: user.sub, role: user.role }, client, 'você')
  await assertClientInArea(promotor, client)
  clientPoint(client)
  const modules = input.modules ?? DEFAULT_MODULES
  if (input.activity && !modules.includes('ATIVIDADES')) throw badRequest('Para escrever uma atividade, inclua a etapa de atividade extra.')
  // Só com atividades extras, a visita precisa de uma atividade: sem ela o promotor iria ao cliente sem nada para fazer
  if (onlyActivities(modules) && !input.activity) throw badRequest('Escreva a atividade extra que o promotor vai fazer neste cliente.', 'ATIVIDADE_OBRIGATORIA')

  const day = toDbDate(input.date)
  const when = input.date === today ? 'hoje' : `em ${shortDate(input.date)}`
  const workDay = input.date === today ? await ensureWorkDay(promotor.id, today) : await prisma.workDay.findUnique({ where: { promotorId_date: { promotorId: promotor.id, date: day } } })
  if (workDay?.closedAt || workDay?.endedAt) throw conflict('O roteiro deste dia já foi encerrado pelo promotor.', 'ROTEIRO_ENCERRADO')
  if (workDay) {
    const existing = await prisma.visit.findFirst({ where: { workDayId: workDay.id, clientId: client.id, status: { in: ['PENDENTE', 'EM_ATENDIMENTO', 'CONCLUIDA'] } } })
    if (existing) {
      throw conflict(
        existing.status === 'CONCLUIDA' ? `${client.name} já foi atendido ${when}.` : `${client.name} já está no roteiro do promotor ${when}.`,
        'CLIENTE_NO_ROTEIRO',
        { visitId: existing.id },
      )
    }
  } else {
    const items = await prisma.routeItem.findMany({ where: { promotorId: promotor.id, clientId: client.id } })
    if (items.some((item) => fallsOn(routeRule(item), input.date))) throw conflict(`${client.name} já está no roteiro do promotor ${when}.`, 'CLIENTE_NO_ROTEIRO')
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      let visitId: string | undefined
      if (workDay) {
        const last = await tx.visit.aggregate({ where: { workDayId: workDay.id }, _max: { position: true } })
        const visit = await tx.visit.create({
          data: {
            workDayId: workDay.id,
            promotorId: promotor.id,
            clientId: client.id,
            date: day,
            position: (last._max.position ?? 0) + 1,
            origin: 'PONTUAL',
            modules,
          },
        })
        visitId = visit.id
      }
      const scheduled = await tx.scheduledVisit.create({
        data: { promotorId: promotor.id, clientId: client.id, date: day, note: input.note?.trim() || null, modules, createdById: user.sub, visitId },
      })
      if (input.activity) {
        await tx.task.create({
          data: {
            title: input.activity.title.trim(),
            clientId: client.id,
            promotorId: promotor.id,
            startDate: day,
            endDate: day,
            recurrence: 'PONTUAL',
            requiresPhoto: input.activity.requiresPhoto,
            required: true,
            createdById: user.sub,
            scheduledVisitId: scheduled.id,
          },
        })
      }
      return tx.scheduledVisit.findUniqueOrThrow({ where: { id: scheduled.id }, include: scheduledInclude })
    })
    return serializeScheduled(created)
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`${client.name} já tem visita pontual ${when}.`, 'VISITA_PONTUAL_DUPLICADA')
    throw error
  }
}

/** Visitas pontuais de hoje em diante de um promotor. */
export async function listScheduled(user: AuthUser, promotorId: string) {
  const list = await prisma.scheduledVisit.findMany({
    where: { promotorId, promotor: promotorScope(user), date: { gte: toDbDate(todayIn()) } },
    include: scheduledInclude,
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
  return list.map(serializeScheduled)
}

/** Desfaz a visita pontual enquanto o promotor não começou a atendê-la. */
export async function cancelScheduled(user: AuthUser, id: string) {
  const s = await prisma.scheduledVisit.findFirst({ where: { id, promotor: promotorScope(user) }, include: { visit: true } })
  if (!s) throw notFound('Visita pontual')
  if (fromDbDate(s.date) < todayIn()) throw conflict('Esta visita pontual é de um dia que já passou.', 'FORA_DO_DIA')
  // Visita pontual que caiu num cliente do roteiro do dia: só desliga o agendamento, a visita do roteiro continua
  const ownVisit = s.visit?.origin === 'PONTUAL' ? s.visit : null
  const started = () => conflict('O promotor já iniciou ou finalizou esta visita; ela não pode mais ser removida.', 'STATUS_INVALIDO')
  if (ownVisit && ownVisit.status !== 'PENDENTE') throw started()
  await prisma.$transaction(async (tx) => {
    if (ownVisit) {
      // Confere de novo dentro da transação: o promotor pode ter aberto o atendimento agora
      const { count } = await tx.visit.deleteMany({ where: { id: ownVisit.id, status: 'PENDENTE' } })
      if (count === 0) throw started()
    }
    await tx.scheduledVisit.delete({ where: { id: s.id } })
  })
}
