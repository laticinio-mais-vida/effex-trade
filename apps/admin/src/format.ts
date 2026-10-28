import type { Area, DistanceMode, PhotoType, RequestStatus, Role, TaskRecurrence, VisitModule, VisitOrigin, VisitStatus } from './types'

export const TZ = (import.meta.env.VITE_TZ as string | undefined) ?? 'America/Bahia'

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** AAAA-MM-DD -> DD/MM/AAAA */
export function fmtDate(date: string | null | undefined) {
  if (!date) return '—'
  const [y, m, d] = date.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function fmtLongDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

/** Data local (AAAA-MM-DD) de um horário, no fuso da operação. */
export function localDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** Hora; inclui a data quando o horário é de outro dia (ex.: roteiro encerrado pelo sistema no dia seguinte). */
export function fmtTimeOn(iso: string | null | undefined, date: string) {
  if (!iso) return '—'
  return localDate(iso) === date ? fmtTime(iso) : fmtDateTime(iso)
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

export function fmtMinutes(min: number | null | undefined) {
  if (min == null) return '—'
  const total = Math.round(min)
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h${m ? ` ${String(m).padStart(2, '0')}min` : ''}`
}

export function fmtNumber(n: number | null | undefined, digits = 0) {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'sem sinal'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h${min % 60 ? ` ${min % 60}min` : ''}`
  return `em ${fmtDateTime(iso)}`
}

export const visitStatusLabel: Record<VisitStatus, string> = {
  PENDENTE: 'Não feito',
  EM_ATENDIMENTO: 'Em atendimento',
  CONCLUIDA: 'Feito',
  JUSTIFICADA: 'Justificado',
  CANCELADA: 'Substituído',
}

export const moduleLabel: Record<VisitModule, string> = { FOTOS: 'Padrão', ATIVIDADES: 'Atividade extra', ESTOQUE: 'Contagem de estoque' }
export const MODULE_ORDER: VisitModule[] = ['FOTOS', 'ATIVIDADES', 'ESTOQUE']
/** Estrutura de todo cliente novo no roteiro: padrão + atividade extra. */
export const DEFAULT_MODULES: VisitModule[] = ['FOTOS', 'ATIVIDADES']
export const isDefaultStructure = (modules: VisitModule[]) => modules.join() === DEFAULT_MODULES.join()
/** "Padrão + atividade extra", "Contagem de estoque"... */
export const structureLabel = (modules: VisitModule[]) => MODULE_ORDER.filter((m) => modules.includes(m)).map((m) => moduleLabel[m]).join(' + ')

export const recurrenceLabel: Record<TaskRecurrence, string> = {
  TODA_VISITA: 'Toda visita',
  PONTUAL: 'Uma vez (pontual)',
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  MENSAL: 'Mensal',
}

export const originLabel: Record<VisitOrigin, string> = { ROTEIRO: 'Roteiro', EXTRA: 'Extra', SUBSTITUICAO: 'Substituição', PONTUAL: 'Pontual' }

export const photoTypeLabel: Record<PhotoType, string> = {
  FACHADA: 'Fachada',
  ANTES: 'Antes',
  DEPOIS: 'Depois',
  RUPTURA: 'Ruptura',
  VENCIMENTO: 'Vencimento',
  ATIVIDADE_EXTRA: 'Atividade extra',
}

export const roleLabel: Record<Role, string> = { ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', VENDEDOR: 'Vendedor', PROMOTOR: 'Promotor' }

/** "Salvador - BA" ou "BA (todas as cidades)" */
export const areaLabel = (a: Area) => (a.city ? `${a.city} - ${a.state}` : `${a.state} (todas as cidades)`)

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']

export const requestStatusLabel: Record<RequestStatus, string> = { PENDENTE: 'Aguardando', APROVADA: 'Aprovada', NEGADA: 'Negada', CANCELADA: 'Cancelada' }

export const weekdayLabel = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export const distanceModeLabel: Record<DistanceMode, string> = {
  ruas: 'pelas ruas',
  linha_reta: 'em linha reta',
  misto: 'parte pelas ruas, parte em linha reta',
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase()
}

/** Gera CSV com ; (abre direto no Excel em PT-BR) e dispara o download. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Lê CSV separado por ; ou , (detecta pelo cabeçalho), com suporte a aspas. */
export function parseCsv(text: string) {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}
