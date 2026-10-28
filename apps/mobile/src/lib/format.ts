import { colors } from './theme'
import type { AuditStatus, PhotoType, RequestStatus, TaskRecurrence, Visit, VisitModule, VisitOrigin, VisitStatus } from './types'

export const photoTypeLabels: Record<PhotoType, string> = {
  FACHADA: 'Fachada',
  ANTES: 'Antes',
  DEPOIS: 'Depois',
  RUPTURA: 'Ruptura',
  VENCIMENTO: 'Vencimento',
  ATIVIDADE_EXTRA: 'Atividade extra',
}

export const visitStatusInfo: Record<VisitStatus, { label: string; color: string; bg: string }> = {
  PENDENTE: { label: 'Não feito', color: colors.muted, bg: colors.neutralSoft },
  EM_ATENDIMENTO: { label: 'Em atendimento', color: colors.info, bg: colors.infoSoft },
  CONCLUIDA: { label: 'Feito', color: colors.success, bg: colors.successSoft },
  JUSTIFICADA: { label: 'Justificado', color: colors.warning, bg: colors.warningSoft },
  CANCELADA: { label: 'Substituído', color: colors.faint, bg: colors.neutralSoft },
}

export const originLabels: Record<VisitOrigin, string | null> = {
  ROTEIRO: null,
  EXTRA: 'Extra',
  SUBSTITUICAO: 'Substituição',
  PONTUAL: 'Pontual',
}

export const moduleLabels: Record<VisitModule, string> = { FOTOS: 'Padrão', ATIVIDADES: 'Atividade extra', ESTOQUE: 'Contagem de estoque' }
export const MODULE_ORDER: VisitModule[] = ['FOTOS', 'ATIVIDADES', 'ESTOQUE']
export const DEFAULT_MODULES: VisitModule[] = ['FOTOS', 'ATIVIDADES']
/** "Padrão + atividade extra", "Contagem de estoque"... */
export const structureLabel = (modules: VisitModule[]) => MODULE_ORDER.filter((m) => modules.includes(m)).map((m) => moduleLabels[m]).join(' + ')
export const isDefaultStructure = (modules: VisitModule[] | undefined) => !modules || modules.join() === DEFAULT_MODULES.join()

export const recurrenceLabels: Record<TaskRecurrence, string | null> = {
  TODA_VISITA: null,
  PONTUAL: 'Uma vez',
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  MENSAL: 'Mensal',
}

export const requestStatusInfo: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  PENDENTE: { label: 'Aguardando', color: colors.warning, bg: colors.warningSoft },
  APROVADA: { label: 'Aprovada', color: colors.success, bg: colors.successSoft },
  NEGADA: { label: 'Negada', color: colors.danger, bg: colors.dangerSoft },
  CANCELADA: { label: 'Cancelada', color: colors.faint, bg: colors.neutralSoft },
}

export const auditStatusInfo: Record<AuditStatus, { label: string; color: string; bg: string }> = {
  APROVADA: { label: 'Aprovada', color: colors.success, bg: colors.successSoft },
  REPROVADA: { label: 'Reprovada', color: colors.danger, bg: colors.dangerSoft },
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '--:--'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** AAAA-MM-DD -> DD/MM/AAAA */
export function formatDate(date: string | null | undefined) {
  if (!date) return ''
  const [y, m, d] = date.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${formatTime(iso)}`
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

export function formatLongDate(date: string) {
  const d = new Date(`${date}T12:00:00`)
  return `${WEEKDAYS[d.getDay()]}, ${formatDate(date)}`
}

/** AAAA-MM-DD somado de alguns dias. */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Dia curto relativo a hoje: "Hoje", "Amanhã" ou "qua 30/10". */
export function formatShortDay(date: string, today: string) {
  if (date === today) return 'Hoje'
  if (date === addDays(today, 1)) return 'Amanhã'
  const d = new Date(`${date}T12:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]!.slice(0, 3)} ${date.slice(8, 10)}/${date.slice(5, 7)}`
}

export function minutesSince(iso: string | null | undefined, until?: string | null) {
  if (!iso) return 0
  const end = until ? new Date(until).getTime() : Date.now()
  return Math.max(0, Math.floor((end - new Date(iso).getTime()) / 60_000))
}

export function formatMinutes(min: number) {
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** Aberturas do atendimento, ex.: "08:10–08:50 e 14:00–em andamento". Sem sessões, usa check-in/check-out da visita. */
export function formatSessions(visit: Pick<Visit, 'sessions' | 'checkinAt' | 'checkoutAt'>) {
  const sessions = visit.sessions?.length
    ? visit.sessions
    : visit.checkinAt
      ? [{ checkinAt: visit.checkinAt, checkoutAt: visit.checkoutAt, autoClosed: false }]
      : []
  const parts = sessions.map(
    (s) => `${formatTime(s.checkinAt)}–${s.checkoutAt ? formatTime(s.checkoutAt) : 'em andamento'}${s.autoClosed ? ' (encerrado automaticamente)' : ''}`,
  )
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

/** Tempo no cliente: soma das aberturas (a aberta conta até agora). */
export function visitMinutes(visit: Pick<Visit, 'sessions' | 'checkinAt' | 'checkoutAt'>) {
  if (visit.sessions?.length) return visit.sessions.reduce((sum, s) => sum + minutesSince(s.checkinAt, s.checkoutAt), 0)
  return minutesSince(visit.checkinAt, visit.checkoutAt)
}

export function formatDistance(meters: number | null | undefined) {
  if (meters == null) return ''
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`
}

/** "Salvador - BA" */
export function placeOf(client: { city: string | null; state?: string | null }) {
  return [client.city, client.state].filter(Boolean).join(' - ')
}

/** Data local de hoje AAAA-MM-DD (aparelho). */
export function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
