import { env } from '../env'

/** Data local (AAAA-MM-DD) no fuso da operação. */
export function todayIn(timezone = env.timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Converte AAAA-MM-DD para o Date usado nas colunas @db.Date (meia-noite UTC). */
export function toDbDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`)
}

export function fromDbDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number) {
  const d = toDbDate(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromDbDate(d)
}

/** Deslocamento do fuso em minutos (ex.: -180 para UTC-3) na data informada. */
function offsetMinutes(timezone: string, at: Date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value
  const match = name?.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0))
}

/** Intervalo [início, fim) em UTC que corresponde ao dia local informado. */
export function localDayRange(date: string, timezone = env.timezone) {
  const midnightUtc = toDbDate(date)
  const start = new Date(midnightUtc.getTime() - offsetMinutes(timezone, midnightUtc) * 60_000)
  const end = new Date(start.getTime() + 24 * 60 * 60_000)
  return { start, end }
}

export function minutesBetween(from: Date, to: Date) {
  return Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10
}
