import { z } from 'zod'
import { RouteFrequency } from '../db'
import { addDays, fromDbDate, toDbDate } from '../lib/dates'
import { badRequest } from '../lib/errors'
import { zDate } from '../lib/validate'

/**
 * Frequência de um cliente no roteiro fixo. A primeira visita (startDate) cai no dia da semana do item e é a
 * referência para quinzenal, mensal e personalizado. Semanal não tem referência: vale toda semana.
 * O painel tem a mesma regra em apps/admin/src/routeFrequency.ts (para mostrar as próximas visitas).
 */
export type RouteRule = { weekday: number; frequency: RouteFrequency; interval: number | null; startDate: string | null }

export const zFrequency = z.object({
  type: z.enum(RouteFrequency).default('SEMANAL'),
  interval: z.number().int().nullish(),
  startDate: zDate.nullish(),
})

const DAY_MS = 86_400_000
const weekdayOf = (date: string) => toDbDate(date).getUTCDay()
const daysBetween = (from: string, to: string) => Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS)
/** Ocorrência do dia da semana no mês (1ª a 4ª); a 5ª conta como "última". */
const weekOfMonth = (date: string) => Math.min(Math.ceil(Number(date.slice(8, 10)) / 7), 5)
const isLastOfMonth = (date: string) => toDbDate(date).getUTCMonth() !== new Date(toDbDate(date).getTime() + 7 * DAY_MS).getUTCMonth()

export const DAYS_INTERVAL = { min: 2, max: 90 }
export const WEEKS_SKIPPED = { min: 1, max: 12 }

/**
 * O cliente do roteiro cai na data? "De X em X dias" pode cair em outro dia da semana; quando cai no domingo,
 * passa para a segunda (próximo dia útil) e a série continua contando a partir do domingo.
 */
export function fallsOn(rule: RouteRule, date: string) {
  if (rule.frequency === 'SEMANAL') return weekdayOf(date) === rule.weekday
  if (!rule.startDate || date < rule.startDate) return false
  const days = daysBetween(rule.startDate, date)
  if (rule.frequency === 'DIAS') {
    const inSeries = (d: string) => d >= rule.startDate! && daysBetween(rule.startDate!, d) % (rule.interval ?? 1) === 0
    const weekday = weekdayOf(date)
    return weekday !== 0 && (inSeries(date) || (weekday === 1 && inSeries(addDays(date, -1))))
  }
  if (weekdayOf(date) !== rule.weekday) return false
  if (rule.frequency === 'QUINZENAL') return (days / 7) % 2 === 0
  if (rule.frequency === 'SEMANAS') return (days / 7) % ((rule.interval ?? 0) + 1) === 0
  const week = weekOfMonth(rule.startDate)
  return week === 5 ? isLastOfMonth(date) : weekOfMonth(date) === week
}

export function routeRule(item: { weekday: number; frequency: RouteFrequency; interval: number | null; startDate: Date | null }): RouteRule {
  return { weekday: item.weekday, frequency: item.frequency, interval: item.interval, startDate: item.startDate ? fromDbDate(item.startDate) : null }
}

export function serializeFrequency(item: { frequency: RouteFrequency; interval: number | null; startDate: Date | null }) {
  return { type: item.frequency, interval: item.interval, startDate: item.startDate ? fromDbDate(item.startDate) : null }
}

/** Valida a frequência pedida para o dia da semana e devolve as colunas do RouteItem. `who` identifica o cliente na mensagem de erro. */
export function frequencyColumns(weekday: number, f: z.infer<typeof zFrequency> | undefined, who?: string) {
  const invalid = (message: string) => badRequest(who ? `${who}: ${message}` : message, 'FREQUENCIA_INVALIDA')
  if (!f || f.type === 'SEMANAL') return { frequency: RouteFrequency.SEMANAL, interval: null, startDate: null }
  if (!f.startDate) throw invalid('informe a data da primeira visita para frequências diferentes de semanal.')
  if (weekdayOf(f.startDate) !== weekday) throw invalid('a primeira visita precisa cair no dia da semana do roteiro.')
  let interval: number | null = null
  if (f.type === 'DIAS') {
    if (!f.interval || f.interval < DAYS_INTERVAL.min || f.interval > DAYS_INTERVAL.max) {
      throw invalid(`informe de quantos em quantos dias (${DAYS_INTERVAL.min} a ${DAYS_INTERVAL.max}).`)
    }
    interval = f.interval
  }
  if (f.type === 'SEMANAS') {
    if (!f.interval || f.interval < WEEKS_SKIPPED.min || f.interval > WEEKS_SKIPPED.max) {
      throw invalid(`informe quantas semanas pular (${WEEKS_SKIPPED.min} a ${WEEKS_SKIPPED.max}).`)
    }
    interval = f.interval
  }
  return { frequency: f.type, interval, startDate: toDbDate(f.startDate) }
}
