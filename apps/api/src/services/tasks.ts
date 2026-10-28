import { prisma, type TaskRecurrence, type VisitModule } from '../db'
import { addDays, fromDbDate, toDbDate } from '../lib/dates'

/**
 * Atividades extras com recorrência. Cada atividade é feita uma vez por janela em cada cliente:
 * toda visita (sem janela), uma vez só (pontual), por semana (segunda a domingo), a cada duas semanas
 * (contadas da semana de início) ou por mês. Feita numa visita, não aparece nas outras visitas da mesma janela.
 */

/** Atividades ativas na data que se aplicam ao promotor e aos clientes informados (sem olhar a recorrência). */
export async function activeTasks(promotorId: string, date: string, clientIds: string[]) {
  const day = toDbDate(date)
  return prisma.task.findMany({
    where: {
      active: true,
      startDate: { lte: day },
      AND: [
        { OR: [{ endDate: null }, { endDate: { gte: day } }] },
        { OR: [{ promotorId }, { promotorId: null }] },
        { OR: [{ clientId: { in: clientIds } }, { clientId: null }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })
}

export type ActiveTask = Awaited<ReturnType<typeof activeTasks>>[number]
type TaskDone = { taskId: string; clientId: string; visitId: string; date: string }
export type TaskContext = { tasks: ActiveTask[]; history: TaskDone[] }

const DAY_MS = 86_400_000
const mondayOf = (date: string) => addDays(date, -((toDbDate(date).getUTCDay() + 6) % 7))

/** Janela [from, to) em que a atividade é feita uma vez no cliente; null = em toda visita. */
export function recurrenceWindow(task: { recurrence: TaskRecurrence; startDate: Date }, date: string): { from: string; to: string | null } | null {
  switch (task.recurrence) {
    case 'TODA_VISITA':
      return null
    case 'PONTUAL':
      return { from: fromDbDate(task.startDate), to: null }
    case 'SEMANAL': {
      const from = mondayOf(date)
      return { from, to: addDays(from, 7) }
    }
    case 'QUINZENAL': {
      const anchor = mondayOf(fromDbDate(task.startDate))
      const weeks = Math.floor((toDbDate(date).getTime() - toDbDate(anchor).getTime()) / (14 * DAY_MS))
      const from = addDays(anchor, weeks * 14)
      return { from, to: addDays(from, 14) }
    }
    case 'MENSAL': {
      const from = `${date.slice(0, 7)}-01`
      const next = toDbDate(from)
      next.setUTCMonth(next.getUTCMonth() + 1)
      return { from, to: fromDbDate(next) }
    }
  }
}

/** Atividades ativas e as conclusões anteriores das que têm recorrência, para decidir o que está por fazer. */
export async function loadTaskContext(promotorId: string, date: string, clientIds: string[]): Promise<TaskContext> {
  const tasks = await activeTasks(promotorId, date, clientIds)
  const windowed = tasks.filter((t) => t.recurrence !== 'TODA_VISITA')
  if (windowed.length === 0 || clientIds.length === 0) return { tasks, history: [] }
  const done = await prisma.taskCompletion.findMany({
    where: { taskId: { in: windowed.map((t) => t.id) }, visit: { clientId: { in: clientIds } } },
    select: { taskId: true, visitId: true, visit: { select: { clientId: true, date: true } } },
  })
  return { tasks, history: done.map((d) => ({ taskId: d.taskId, visitId: d.visitId, clientId: d.visit.clientId, date: fromDbDate(d.visit.date) })) }
}

/** A atividade está por fazer neste cliente na data? visitId: a visita atual (conclusão nela não conta como "já feita antes"). */
function isDue(ctx: TaskContext, task: ActiveTask, clientId: string, date: string, visitId: string | null) {
  const window = recurrenceWindow(task, date)
  if (!window) return true
  return !ctx.history.some(
    (h) => h.taskId === task.id && h.clientId === clientId && h.visitId !== visitId && h.date >= window.from && (window.to === null || h.date < window.to),
  )
}

const appliesTo = (task: ActiveTask, clientId: string) => !task.clientId || task.clientId === clientId

/**
 * Atividades de uma visita: só quando a estrutura dela tem atividades extras. Entram as que estão por fazer
 * na janela e as já feitas nesta visita (ao reabrir o cliente, as feitas continuam feitas).
 */
export function tasksOfVisit(
  ctx: TaskContext,
  visit: { id: string; clientId: string; date: Date; modules: VisitModule[]; taskCompletions: { taskId: string; completedAt: Date; notes: string | null }[] },
) {
  if (!visit.modules.includes('ATIVIDADES')) return []
  const date = fromDbDate(visit.date)
  return ctx.tasks
    .filter((t) => appliesTo(t, visit.clientId))
    .flatMap((t) => {
      const completion = visit.taskCompletions.find((c) => c.taskId === t.id)
      if (!completion && !isDue(ctx, t, visit.clientId, date, visit.id)) return []
      return [
        {
          id: t.id,
          title: t.title,
          description: t.description,
          recurrence: t.recurrence,
          requiresPhoto: t.requiresPhoto,
          required: t.required,
          done: !!completion,
          completedAt: completion?.completedAt ?? null,
          notes: completion?.notes ?? null,
        },
      ]
    })
}

/** Existe atividade por fazer para o cliente na data? (gera o dia das estruturas só com atividades extras) */
export function hasDueTask(ctx: TaskContext, clientId: string, date: string) {
  return ctx.tasks.some((t) => appliesTo(t, clientId) && isDue(ctx, t, clientId, date, null))
}
