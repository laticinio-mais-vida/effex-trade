import { tones, type Tone } from './theme'
import type { AuditStatus, ContestStatus, PhotoType, RequestStatus, Role, TaskRecurrence, Visit, VisitModule, VisitOrigin, VisitStatus } from './types'

export const photoTypeLabels: Record<PhotoType, string> = {
  FACHADA: 'Fachada',
  ANTES: 'Antes',
  DEPOIS: 'Depois',
  RUPTURA: 'Ruptura',
  VENCIMENTO: 'Vencimento',
  ATIVIDADE_EXTRA: 'Atividade extra',
}

/** Rótulo e cor de status: `tone` para os componentes (Badge), color/bg para quem pinta direto. */
export type StatusInfo = { label: string; tone: Tone; color: string; bg: string }
const info = (label: string, tone: Tone): StatusInfo => ({ label, tone, color: tones[tone].forte, bg: tones[tone].suave })

/** Status da visita com o dia aberto: "Não feito" fica cinza enquanto ainda dá tempo. */
export const visitStatusInfo: Record<VisitStatus, StatusInfo> = {
  PENDENTE: info('Não feito', 'neutro'),
  EM_ATENDIMENTO: info('Em atendimento', 'emAtendimento'),
  CONCLUIDA: info('Feito', 'feito'),
  JUSTIFICADA: info('Justificado', 'justificado'),
  CANCELADA: info('Substituído', 'neutro'),
}

/** "Não feito" é cinza com o dia aberto e vermelho nos dias anteriores (o rótulo não muda). */
export function visitStatusFor(status: VisitStatus, dayOpen: boolean): StatusInfo {
  if (status === 'PENDENTE' && !dayOpen) return info('Não feito', 'naoFeito')
  return visitStatusInfo[status]
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

export const requestStatusInfo: Record<RequestStatus, StatusInfo> = {
  PENDENTE: info('Aguardando', 'neutro'),
  APROVADA: info('Aprovada', 'feito'),
  NEGADA: info('Negada', 'naoFeito'),
  CANCELADA: info('Cancelada', 'neutro'),
}

/** Foto: Pendente cinza, Aprovada verde, Reprovada vermelho. */
export const photoPendingInfo: StatusInfo = info('Pendente', 'neutro')
export const auditStatusInfo: Record<AuditStatus, StatusInfo> = {
  APROVADA: info('Aprovada', 'feito'),
  REPROVADA: info('Reprovada', 'naoFeito'),
}

/** Conferência da auditoria do vendedor: "A conferir" cinza, Correta verde, Incorreta vermelho. */
export const reviewPendingInfo: StatusInfo = info('A conferir', 'neutro')
export const reviewVerdictInfo: Record<'CORRETA' | 'INCORRETA', StatusInfo> = {
  CORRETA: info('Correta', 'feito'),
  INCORRETA: info('Incorreta', 'naoFeito'),
}

export const contestStatusInfo: Record<ContestStatus, StatusInfo> = {
  PENDENTE: info('Contestação aguardando', 'neutro'),
  ACEITA: info('Contestação aceita', 'feito'),
  NEGADA: info('Contestação negada', 'naoFeito'),
}

export const roleLabels: Record<Role, string> = { ADMIN: 'administrador', SUPERVISOR: 'supervisor', VENDEDOR: 'vendedor', PROMOTOR: 'promotor' }

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
