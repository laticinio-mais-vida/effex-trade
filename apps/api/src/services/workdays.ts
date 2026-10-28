import { isUniqueViolation, prisma } from '../db'
import { toDbDate } from '../lib/dates'

/**
 * Garante a jornada do promotor na data, gerando as visitas a partir do roteiro fixo
 * (dia da semana). O plano do dia fica congelado a partir daí: mudanças no roteiro fixo
 * valem para os próximos dias.
 */
export async function ensureWorkDay(promotorId: string, date: string) {
  const day = toDbDate(date)
  const existing = await prisma.workDay.findUnique({ where: { promotorId_date: { promotorId, date: day } } })
  if (existing) return existing

  const items = await prisma.routeItem.findMany({
    where: { promotorId, weekday: day.getUTCDay(), client: { active: true } },
    orderBy: { position: 'asc' },
  })
  try {
    return await prisma.workDay.create({
      data: {
        promotorId,
        date: day,
        visits: { create: items.map((item, i) => ({ promotorId, clientId: item.clientId, date: day, position: i + 1 })) },
      },
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
