import { addDays, today } from './format'
import type { Frequency, FrequencyType } from './types'

/**
 * Frequência do cliente no roteiro. Mesma regra da API (apps/api/src/services/route-frequency.ts),
 * usada aqui para mostrar as próximas visitas enquanto o roteiro é montado.
 */
export const WEEKLY: Frequency = { type: 'SEMANAL', interval: null, startDate: null }
export const DAYS_INTERVAL = { min: 2, max: 90, initial: 10 }
export const WEEKS_SKIPPED = { min: 1, max: 12, initial: 2 }

const DAY_MS = 86_400_000
const asDate = (date: string) => new Date(`${date}T00:00:00Z`)
const weekdayOf = (date: string) => asDate(date).getUTCDay()
const daysBetween = (from: string, to: string) => Math.round((asDate(to).getTime() - asDate(from).getTime()) / DAY_MS)
/** Ocorrência do dia da semana no mês (1ª a 4ª); a 5ª conta como "última". */
const weekOfMonth = (date: string) => Math.min(Math.ceil(Number(date.slice(8, 10)) / 7), 5)
const isLastOfMonth = (date: string) => asDate(date).getUTCMonth() !== asDate(addDays(date, 7)).getUTCMonth()

const weekdayShort = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const weekdayName = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
/** "seg 03/11" */
export const fmtShortDay = (date: string) => `${weekdayShort[weekdayOf(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`

/** De X em X dias que cai no domingo passa para a segunda (próximo dia útil); a série continua contando do domingo. */
export function fallsOn(weekday: number, f: Frequency, date: string) {
  if (f.type === 'SEMANAL') return weekdayOf(date) === weekday
  if (!f.startDate || date < f.startDate) return false
  const days = daysBetween(f.startDate, date)
  if (f.type === 'DIAS') {
    const inSeries = (d: string) => d >= f.startDate! && daysBetween(f.startDate!, d) % (f.interval ?? 1) === 0
    const day = weekdayOf(date)
    return day !== 0 && (inSeries(date) || (day === 1 && inSeries(addDays(date, -1))))
  }
  if (weekdayOf(date) !== weekday) return false
  if (f.type === 'QUINZENAL') return (days / 7) % 2 === 0
  if (f.type === 'SEMANAS') return (days / 7) % ((f.interval ?? 0) + 1) === 0
  const week = weekOfMonth(f.startDate)
  return week === 5 ? isLastOfMonth(date) : weekOfMonth(date) === week
}

/** Próximas visitas a partir de amanhã (o roteiro de hoje já foi gerado). */
export function nextVisits(weekday: number, f: Frequency, count = 4) {
  const dates: string[] = []
  for (let date = addDays(today(), 1), i = 0; dates.length < count && i < 400; date = addDays(date, 1), i++) {
    if (fallsOn(weekday, f, date)) dates.push(date)
  }
  return dates
}

/** Próximas ocorrências do dia da semana depois de hoje: opções para a primeira visita. */
export function upcomingWeekdays(weekday: number, count = 8) {
  let first = addDays(today(), 1)
  while (weekdayOf(first) !== weekday) first = addDays(first, 1)
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7))
}

/** Frequência nova a partir do tipo escolhido, mantendo a primeira visita quando já havia uma. */
export function withType(weekday: number, current: Frequency, type: FrequencyType): Frequency {
  if (type === 'SEMANAL') return WEEKLY
  const startDate = current.startDate ?? upcomingWeekdays(weekday, 1)[0]!
  const interval = type === 'DIAS' ? DAYS_INTERVAL.initial : type === 'SEMANAS' ? WEEKS_SKIPPED.initial : null
  return { type, interval: current.type === type ? current.interval : interval, startDate }
}

export function weekOfMonthLabel(weekday: number, startDate: string) {
  const week = weekOfMonth(startDate)
  return `${week === 5 ? 'última' : `${week}ª`} ${weekdayName[weekday]} do mês`
}

export function frequencyLabel(weekday: number, f: Frequency) {
  if (f.type === 'SEMANAL') return 'Semanal'
  if (f.type === 'QUINZENAL') return 'Quinzenal'
  if (f.type === 'MENSAL') return f.startDate ? `Mensal, toda ${weekOfMonthLabel(weekday, f.startDate)}` : 'Mensal'
  if (f.type === 'DIAS') return `De ${f.interval ?? '?'} em ${f.interval ?? '?'} dias`
  return `Pulando ${f.interval ?? '?'} ${f.interval === 1 ? 'semana' : 'semanas'}`
}

/** Mensagem do que falta para a frequência valer, ou null se está completa. */
export function frequencyError(f: Frequency) {
  if (f.type === 'SEMANAL') return null
  if (!f.startDate) return 'escolha a primeira visita'
  if (f.type === 'DIAS' && (f.interval == null || f.interval < DAYS_INTERVAL.min || f.interval > DAYS_INTERVAL.max)) {
    return `o intervalo vai de ${DAYS_INTERVAL.min} a ${DAYS_INTERVAL.max} dias`
  }
  if (f.type === 'SEMANAS' && (f.interval == null || f.interval < WEEKS_SKIPPED.min || f.interval > WEEKS_SKIPPED.max)) {
    return `pule de ${WEEKS_SKIPPED.min} a ${WEEKS_SKIPPED.max} semanas`
  }
  return null
}

export const sameFrequency = (a: Frequency, b: Frequency) => a.type === b.type && a.interval === b.interval && a.startDate === b.startDate
