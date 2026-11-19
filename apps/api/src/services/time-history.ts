import { prisma } from '../db'
import { toDbDate } from '../lib/dates'
import { nameKey } from '../lib/cities'

/**
 * Histórico de visitas importado de outro sistema (TradePro), para as medianas do relatório de tempos (ver `TimeHistory` no
 * schema). Entra a planilha do relatório de roteiros, com uma linha por cliente do roteiro de um promotor num dia.
 */

export const HISTORY_SOURCE = 'TRADEPRO'

/** Horário de Brasília/Bahia (sem horário de verão): o que a planilha traz como hora local. */
const LOCAL_OFFSET_MS = 3 * 60 * 60_000
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000

/** Valor de célula: texto, número (data/hora do Excel) ou Date (o leitor do .xlsx devolve em UTC, como hora "de parede"). */
export type Cell = string | number | Date | null | undefined

export type HistoryRow = {
  line: number
  date: string
  promotorName: string
  supervisorName: string | null
  clientKey: string
  clientName: string
  city: string | null
  checkinAt: Date | null
  checkoutAt: Date | null
  clientSeconds: number
  travelSeconds: number
  status: string | null
  reason: string | null
  comment: string | null
}

const HEADERS = {
  promotor: ['colaborador', 'promotor'],
  supervisor: ['supervisor'],
  document: ['cpf/cnpj', 'cpf cnpj', 'cnpj', 'cpf', 'documento'],
  client: ['fantasia', 'nome fantasia', 'cliente'],
  city: ['cidade'],
  date: ['data visita', 'data'],
  checkin: ['hora inicio', 'check-in', 'checkin'],
  checkout: ['hora final', 'check-out', 'checkout'],
  clientTime: ['tempo no roteiro', 'tempo no cliente'],
  travelTime: ['tempo de deslocamento', 'deslocamento'],
  reason: ['motivo nao visita', 'motivo'],
  comment: ['comentario', 'justificativa'],
  status: ['status roteiros', 'status'],
} as const

const norm = (v: Cell) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const text = (v: Cell) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

/** Promotor sem o sufixo entre parênteses no fim e em maiúsculas: "AMARANTA (BA)" e "AMARANTA (ITABELA)" são "AMARANTA". */
export function promotorKey(name: string) {
  return name
    .replace(/(\s*\([^)]*\))+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Conta de teste ("MARCELO (TESTE)"): fica fora do histórico, porque contamina as medianas. */
export const isTestAccount = (name: string) => /\(\s*teste\s*\)/i.test(name)

/**
 * CPF/CNPJ só com dígitos. O Excel come os zeros à esquerda quando a coluna vira número: CNPJ de 13 dígitos e CPF de 10
 * voltam ao tamanho certo.
 */
export function cleanDocument(value: Cell) {
  const digits = text(value).replace(/\D/g, '')
  if (digits.length === 13) return digits.padStart(14, '0')
  if (digits.length === 10) return digits.padStart(11, '0')
  return digits.length === 11 || digits.length === 14 ? digits : null
}

/** Hora de parede (sem fuso) de uma célula: dia e fração do dia em milissegundos desde a meia-noite UTC "de mentira". */
function wallClock(v: Cell): number | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? EXCEL_EPOCH_MS + Math.round(v * DAY_MS) : null
  const s = v.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return EXCEL_EPOCH_MS + Math.round(Number(s) * DAY_MS)
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (br) return Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 0), Number(br[5] ?? 0), Number(br[6] ?? 0))
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0))
  return null
}

export function parseDay(v: Cell) {
  const ms = wallClock(v)
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10)
}

/** Instante real a partir da hora local da planilha. */
export function parseMoment(v: Cell) {
  const ms = wallClock(v)
  return ms == null ? null : new Date(ms + LOCAL_OFFSET_MS)
}

/** "HH:MM:SS" (ou "HH:MM", ou fração de dia do Excel) em segundos inteiros; vazio ou inválido, 0. */
export function parseSeconds(v: Cell) {
  if (v == null || v === '') return 0
  if (v instanceof Date) return Math.max(0, Math.round(((v.getTime() - EXCEL_EPOCH_MS) % DAY_MS) / 1000))
  if (typeof v === 'number') return Math.max(0, Math.round(v * 86_400))
  const m = v.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : 0
}

export type ParsedHistory = { rows: HistoryRow[]; problems: { line: number; message: string }[]; excludedTest: number; missing: string[] }

/** Lê a tabela (primeira linha com "Colaborador" é o cabeçalho; o que vem antes, como o título do relatório, é ignorado). */
export function parseHistoryTable(table: Cell[][]): ParsedHistory {
  const headerAt = table.findIndex((r) => r.some((c) => HEADERS.promotor.includes(norm(c) as never)))
  const result: ParsedHistory = { rows: [], problems: [], excludedTest: 0, missing: [] }
  if (headerAt < 0) {
    result.missing.push('cabeçalho com a coluna "Colaborador"')
    return result
  }
  const header = table[headerAt]!.map(norm)
  const col = (key: keyof typeof HEADERS) => header.findIndex((h) => (HEADERS[key] as readonly string[]).includes(h))
  const idx = Object.fromEntries((Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map((k) => [k, col(k)])) as Record<keyof typeof HEADERS, number>
  for (const need of ['promotor', 'document', 'client', 'date', 'clientTime', 'travelTime'] as const) {
    if (idx[need] < 0) result.missing.push(HEADERS[need][0])
  }
  if (result.missing.length) return result

  for (const [i, cells] of table.slice(headerAt + 1).entries()) {
    const line = headerAt + 2 + i
    if (cells.every((c) => c == null || c === '')) continue
    const get = (k: keyof typeof HEADERS): Cell => (idx[k] >= 0 ? cells[idx[k]] : null)
    const rawPromotor = text(get('promotor'))
    if (isTestAccount(rawPromotor)) {
      result.excludedTest++
      continue
    }
    const date = parseDay(get('date'))
    const clientKey = cleanDocument(get('document'))
    if (!rawPromotor || !date || !clientKey) {
      result.problems.push({ line, message: !rawPromotor ? 'sem colaborador' : !date ? `data inválida (${text(get('date'))})` : `CPF/CNPJ inválido (${text(get('document'))})` })
      continue
    }
    result.rows.push({
      line,
      date,
      promotorName: promotorKey(rawPromotor),
      supervisorName: text(get('supervisor')) || null,
      clientKey,
      clientName: text(get('client')).replace(/\s*\(CLIENTE\s*[^)]*\)/gi, '').replace(/\s*\(R \d+\)/gi, ''),
      city: text(get('city')) || null,
      checkinAt: parseMoment(get('checkin')),
      checkoutAt: parseMoment(get('checkout')),
      clientSeconds: parseSeconds(get('clientTime')),
      travelSeconds: parseSeconds(get('travelTime')),
      status: text(get('status')) || null,
      reason: text(get('reason')) || null,
      comment: text(get('comment')) || null,
    })
  }
  return result
}

/** Usuário do EFFEX para o nome do promotor da planilha: nome igual, ou um que começa com o outro (só se for um único). */
function promotorMatcher(users: { id: string; name: string }[]) {
  const keyed = users.map((u) => ({ id: u.id, key: nameKey(u.name) }))
  return (name: string) => {
    const key = nameKey(name)
    const exact = keyed.filter((u) => u.key === key)
    if (exact.length === 1) return exact[0]!.id
    if (exact.length > 1) return null
    const partial = keyed.filter((u) => u.key.startsWith(`${key} `) || key.startsWith(`${u.key} `))
    return partial.length === 1 ? partial[0]!.id : null
  }
}

const BATCH = 2000

export type ImportReport = {
  rows: number
  from: string | null
  to: string | null
  days: number
  replaced: number
  visited: number
  withoutVisit: number
  promotors: { name: string; rows: number; userId: string | null }[]
  clients: { total: number; linked: number; unlinked: { key: string; name: string; city: string | null; rows: number }[] }
  /** Permanência ou deslocamento acima de 12 h: check-out esquecido na origem (a mediana ignora, mas vale conhecer) */
  forgottenCheckouts: number
  dryRun: boolean
}

/**
 * Grava o histórico no banco. Reimportar troca as linhas da mesma origem no período do arquivo (de ponta a ponta), então
 * rodar o mesmo arquivo duas vezes não duplica. Com `dryRun`, só confere e conta.
 */
export async function importTimeHistory(rows: HistoryRow[], options: { source?: string; dryRun?: boolean } = {}): Promise<ImportReport> {
  const source = options.source ?? HISTORY_SOURCE
  const dates = rows.map((r) => r.date).sort()
  const from = dates[0] ?? null
  const to = dates.at(-1) ?? null

  const [users, clients] = await Promise.all([
    prisma.user.findMany({ where: { role: 'PROMOTOR' }, select: { id: true, name: true } }),
    prisma.client.findMany({ where: { document: { not: null } }, select: { id: true, document: true } }),
  ])
  const matchUser = promotorMatcher(users)
  const userByName = new Map([...new Set(rows.map((r) => r.promotorName))].map((n) => [n, matchUser(n)]))
  // Dois cadastros com o mesmo CPF/CNPJ: ninguém é escolhido (ambíguo)
  const clientByDoc = new Map<string, string | null>()
  for (const c of clients) clientByDoc.set(c.document!, clientByDoc.has(c.document!) ? null : c.id)

  const data = rows.map((r) => ({
    source,
    date: toDbDate(r.date),
    promotorName: r.promotorName,
    promotorId: userByName.get(r.promotorName) ?? null,
    supervisorName: r.supervisorName,
    clientKey: r.clientKey,
    clientName: r.clientName,
    city: r.city,
    clientId: clientByDoc.get(r.clientKey) ?? null,
    checkinAt: r.checkinAt,
    checkoutAt: r.checkoutAt,
    clientSeconds: r.clientSeconds,
    travelSeconds: r.travelSeconds,
    status: r.status,
    reason: r.reason,
    comment: r.comment,
  }))

  let replaced = 0
  if (!options.dryRun && from && to) {
    await prisma.$transaction(
      async (tx) => {
        replaced = (await tx.timeHistory.deleteMany({ where: { source, date: { gte: toDbDate(from), lte: toDbDate(to) } } })).count
        for (let i = 0; i < data.length; i += BATCH) await tx.timeHistory.createMany({ data: data.slice(i, i + BATCH) })
      },
      { maxWait: 10_000, timeout: 300_000 },
    )
  }

  const byPromotor = new Map<string, number>()
  const byClient = new Map<string, { name: string; city: string | null; rows: number }>()
  for (const r of rows) {
    byPromotor.set(r.promotorName, (byPromotor.get(r.promotorName) ?? 0) + 1)
    const c = byClient.get(r.clientKey)
    if (c) c.rows++
    else byClient.set(r.clientKey, { name: r.clientName, city: r.city, rows: 1 })
  }
  const unlinked = [...byClient].filter(([key]) => !clientByDoc.get(key)).map(([key, c]) => ({ key, ...c }))
  return {
    rows: rows.length,
    from,
    to,
    days: new Set(dates).size,
    replaced,
    visited: rows.filter((r) => r.clientSeconds > 0).length,
    withoutVisit: rows.filter((r) => r.clientSeconds <= 0).length,
    promotors: [...byPromotor].map(([name, n]) => ({ name, rows: n, userId: userByName.get(name) ?? null })).sort((a, b) => b.rows - a.rows),
    clients: { total: byClient.size, linked: byClient.size - unlinked.length, unlinked },
    forgottenCheckouts: rows.filter((r) => r.clientSeconds > 12 * 3600 || r.travelSeconds > 12 * 3600).length,
    dryRun: !!options.dryRun,
  }
}
