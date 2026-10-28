import { prisma, Prisma } from '../db'
import { env } from '../env'
import { toDbDate, todayIn } from '../lib/dates'
import { getSettings } from './settings'

export const ALERT_LUNCH = 'ALMOCO_LONGO'

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: env.timezone })

function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h${m ? ` ${String(m).padStart(2, '0')}min` : ''}` : `${m} min`
}

/**
 * Cria alerta para o supervisor quando o almoço passa do limite das regras (por promotor) e marca como
 * resolvido quando o promotor volta. Roda a cada minuto no servidor e também antes de listar alertas.
 */
export async function checkLunchAlerts(now = new Date()) {
  const open = await prisma.workDay.findMany({
    where: { date: toDbDate(todayIn(env.timezone, now)), lunchStartedAt: { not: null }, lunchEndedAt: null, closedAt: null },
    include: { promotor: { select: { name: true } } },
  })
  for (const wd of open) {
    const limit = (await getSettings(wd.promotorId)).lunchAlertMinutes
    if (limit <= 0) continue
    if ((now.getTime() - wd.lunchStartedAt!.getTime()) / 60_000 < limit) continue
    await prisma.alert.createMany({
      data: [
        {
          type: ALERT_LUNCH,
          promotorId: wd.promotorId,
          workDayId: wd.id,
          message: `${wd.promotor.name} está em almoço desde ${hhmm(wd.lunchStartedAt!)} e passou de ${fmtDuration(limit)}.`,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    })
  }

  const unresolved = await prisma.alert.findMany({ where: { type: ALERT_LUNCH, resolvedAt: null }, include: { workDay: true } })
  for (const a of unresolved) {
    const end = a.workDay?.lunchEndedAt ?? a.workDay?.closedAt
    if (end) await prisma.alert.update({ where: { id: a.id }, data: { resolvedAt: end } })
  }
}

export const alertInclude = {
  promotor: { select: { id: true, name: true, phone: true } },
  acknowledgedBy: { select: { id: true, name: true } },
  workDay: { select: { lunchStartedAt: true, lunchEndedAt: true } },
} satisfies Prisma.AlertInclude

type AlertWithRelations = Prisma.AlertGetPayload<{ include: typeof alertInclude }>

export function serializeAlert(a: AlertWithRelations) {
  return {
    id: a.id,
    type: a.type,
    message: a.message,
    promotor: a.promotor,
    createdAt: a.createdAt,
    resolvedAt: a.resolvedAt,
    acknowledgedAt: a.acknowledgedAt,
    acknowledgedBy: a.acknowledgedBy,
    lunchStartedAt: a.workDay?.lunchStartedAt ?? null,
    lunchEndedAt: a.workDay?.lunchEndedAt ?? null,
  }
}
