import { isUniqueViolation, prisma, type VisitModule } from '../db'
import { toDbDate } from '../lib/dates'
import { fallsOn, routeRule } from './route-frequency'
import { hasDueTask, loadTaskContext } from './tasks'
import { mergeModules, onlyActivities } from './visit-structure'

/**
 * Garante a jornada do promotor na data, gerando as visitas a partir do roteiro fixo
 * (dia da semana, frequência e estrutura de cada cliente) e das visitas pontuais agendadas pelo supervisor.
 * O plano do dia fica congelado a partir daí: mudanças no roteiro fixo valem para os próximos dias.
 */
export async function ensureWorkDay(promotorId: string, date: string) {
  const day = toDbDate(date)
  const existing = await prisma.workDay.findUnique({ where: { promotorId_date: { promotorId, date: day } } })
  if (existing) return existing

  const weekday = day.getUTCDay()
  // Clientes deste dia da semana, mais os "de X em X dias" cadastrados em outro dia que caem nesta data
  const items = await prisma.routeItem.findMany({
    where: { promotorId, client: { active: true }, OR: [{ weekday }, { frequency: 'DIAS' }] },
    orderBy: { position: 'asc' },
  })
  const due = items
    .filter((item) => fallsOn(routeRule(item), date))
    // Os do próprio dia na ordem do roteiro; os que vêm de outro dia da semana entram no fim
    .sort((a, b) => Number(a.weekday !== weekday) - Number(b.weekday !== weekday) || a.weekday - b.weekday || a.position - b.position)
  // Cliente que cai mais de uma vez no dia vira uma visita só, com as etapas somadas
  const planned = new Map<string, VisitModule[]>()
  for (const item of due) planned.set(item.clientId, mergeModules(planned.get(item.clientId) ?? [], item.modules))
  const activityOnly = [...planned].filter(([, modules]) => onlyActivities(modules)).map(([clientId]) => clientId)
  if (activityOnly.length > 0) {
    const ctx = await loadTaskContext(promotorId, date, activityOnly)
    for (const clientId of activityOnly) if (!hasDueTask(ctx, clientId, date)) planned.delete(clientId)
  }
  const routeClients = [...planned]
  const scheduled = await prisma.scheduledVisit.findMany({ where: { promotorId, date: day, client: { active: true } }, orderBy: { createdAt: 'asc' } })

  try {
    return await prisma.$transaction(async (tx) => {
      const workDay = await tx.workDay.create({
        data: {
          promotorId,
          date: day,
          visits: { create: routeClients.map(([clientId, modules], i) => ({ promotorId, clientId, date: day, position: i + 1, modules })) },
        },
      })
      // Visitas pontuais entram no fim; se o cliente já caiu no roteiro do dia, a pontual fica ligada a essa visita
      // e as etapas pedidas pelo supervisor se somam às do roteiro
      const routeVisits = scheduled.length ? await tx.visit.findMany({ where: { workDayId: workDay.id }, select: { id: true, clientId: true, modules: true } }) : []
      let position = routeClients.length
      for (const s of scheduled) {
        const routeVisit = routeVisits.find((v) => v.clientId === s.clientId)
        if (routeVisit) await tx.visit.update({ where: { id: routeVisit.id }, data: { modules: mergeModules(routeVisit.modules, s.modules) } })
        const visitId =
          routeVisit?.id ??
          (await tx.visit.create({
            data: { workDayId: workDay.id, promotorId, clientId: s.clientId, date: day, position: ++position, origin: 'PONTUAL', modules: s.modules },
          })).id
        await tx.scheduledVisit.update({ where: { id: s.id }, data: { visitId } })
      }
      return workDay
    })
  } catch (error) {
    // Duas requisições simultâneas tentando gerar o mesmo dia
    if (isUniqueViolation(error)) return prisma.workDay.findUniqueOrThrow({ where: { promotorId_date: { promotorId, date: day } } })
    throw error
  }
}

/** Gera a jornada do dia para todos os promotores ativos (roda no início do dia e ao abrir o mapa). */
export async function ensureWorkDaysForAll(date: string) {
  const promotores = await prisma.user.findMany({ where: { role: 'PROMOTOR', active: true }, select: { id: true } })
  for (const p of promotores) await ensureWorkDay(p.id, date)
}
