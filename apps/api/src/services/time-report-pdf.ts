import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env'
import { toDbDate } from '../lib/dates'
import type { Occurrence, PromotorDay, RowState, TimeReport } from './time-report'

/** PDFs do relatório de tempos: individual (um promotor) e consolidado (todos, para o supervisor). */

const ORANGE = '#EF7D00'
const BLUE = '#009FE3'
const GREEN = '#25563A'
const NAVY = '#1E2A5E'
const CREAM = '#FBEFE2'
const INK = '#1f2933'
const MUTED = '#616e7c'
const LINE = '#d9dee4'
const LOGO = join(process.cwd(), 'assets', 'mais-vida.png')

// ---------- Formatos ----------

const pad = (n: number) => String(n).padStart(2, '0')
/** Tempo absoluto HH:MM:SS */
export const fmtHms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`
/** Tempo curto de resumo: 2h58 (ou 12min abaixo de 1 h) */
export const fmtShort = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}` : `${Math.round(s / 60)}min`)
/** Diferença curta e com sinal: +1h49, -32min */
export const fmtDiff = (s: number) => `${s < 0 ? '-' : '+'}${fmtShort(Math.abs(s))}`
const fmtClock = (d: Date | null) =>
  d
    ? d.toLocaleTimeString('pt-BR', {
        timeZone: env.timezone,
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--:--'
const fmtDateBr = (iso: string) => iso.split('-').reverse().join('/')
const fmtDateLong = (iso: string) =>
  toDbDate(iso).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
const dash = (v: string | null | undefined) => (v && v.trim() ? v : '-')

const stateLabel: Record<RowState, string> = {
  FEITA: 'Feito',
  EM_ATENDIMENTO: 'Em atendimento',
  JUSTIFICADA: 'Justificado',
  PENDENTE: 'A visitar',
  NAO_FEITA: 'Sem justificativa',
}

const kindLabel = (o: Occurrence) => (o.kind === 'DESLOCAMENTO' ? 'Deslocamento longo' : o.direction === 'ACIMA' ? 'Tempo longo na loja' : 'Tempo curto na loja')
const kindColor = (o: Occurrence) => (o.direction === 'ABAIXO' ? BLUE : ORANGE)
const star = (o: Occurrence) => (o.fallback ? ' *' : '')
const when = (o: Occurrence) => `${fmtClock(o.from)} - ${fmtClock(o.to)}`
const variation = (o: Occurrence) => `${fmtDiff(o.diffSeconds)} (${o.ratio >= 100 ? '99+' : o.ratio.toFixed(1)}x)`
const isRange = (r: TimeReport) => r.dateTo !== r.date
const statusLine = (r: TimeReport) => (isRange(r) ? (r.isToday ? 'Período até o último registro' : 'Período encerrado') : r.isToday ? 'Dia em andamento' : 'Dia encerrado')
const periodLong = (r: TimeReport) => (isRange(r) ? `${fmtDateBr(r.date)} a ${fmtDateBr(r.dateTo)}` : fmtDateLong(r.date))
const dayShort = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

/** No relatório de período, cada tabela ganha a coluna DATA (as demais encolhem um pouco). */
function withDate(ranged: boolean, width: number, cols: Col[], rows: Cell[][], dates: string[]): [Col[], Cell[][]] {
  if (!ranged) return [cols, rows]
  return [[{ label: 'DATA', width: width * 0.08 }, ...cols.map((c) => ({ label: c.label === 'TEMPO DO DIA' ? 'TEMPO' : c.label, width: c.width * 0.92 }))], rows.map((r, i) => [{ text: dayShort(dates[i]!) }, ...r])]
}

// ---------- Desenho ----------

type Col = { label: string; width: number }
type Cell = { text: string; color?: string; bold?: boolean }

class Pdf {
  doc: InstanceType<typeof PDFDocument>
  left: number
  width: number
  private chunks: Buffer[] = []
  done: Promise<Buffer>

  constructor(
    private title: string,
    private subtitle: string,
    layout: 'portrait' | 'landscape',
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout,
      margin: 36,
      bufferPages: true,
      info: { Title: title },
    })
    this.doc.on('data', (c: Buffer) => this.chunks.push(c))
    this.done = new Promise((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))))
    this.left = this.doc.page.margins.left
    this.width = this.doc.page.width - this.left - this.doc.page.margins.right
    this.band()
  }

  get bottom() {
    return this.doc.page.height - 46
  }

  /** Faixa laranja do topo, com o logo e o título, e o filete verde. */
  private band() {
    const d = this.doc
    const w = d.page.width
    d.rect(0, 0, w, 62).fill(ORANGE)
    d.rect(0, 62, w, 5).fill(GREEN)
    if (existsSync(LOGO)) d.image(LOGO, this.left, 10, { height: 42 })
    d.fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(this.title, 0, 18, { width: w - this.left, align: 'right' })
    d.font('Helvetica')
      .fontSize(9)
      .text(this.subtitle, 0, 36, { width: w - this.left, align: 'right' })
    d.y = 84
  }

  page() {
    this.doc.addPage()
    this.band()
  }

  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.page()
  }

  heading(text: string, color = ORANGE) {
    this.ensure(60)
    this.doc.moveDown(0.4)
    this.doc.fillColor(color).font('Helvetica-Bold').fontSize(13).text(text, this.left, this.doc.y, { width: this.width })
    this.doc.moveDown(0.4)
  }

  paragraph(text: string, size = 9, color = MUTED) {
    this.ensure(30)
    this.doc.fillColor(color).font('Helvetica').fontSize(size).text(text, this.left, this.doc.y, { width: this.width })
    this.doc.moveDown(0.4)
  }

  table(cols: Col[], rows: Cell[][], opts: { accent?: string; empty?: string } = {}) {
    const d = this.doc
    const pad = 6
    const header = () => {
      const y = d.y
      d.rect(this.left, y, this.width, 22).fill(NAVY)
      let x = this.left
      d.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5)
      for (const c of cols) {
        d.text(c.label, x + pad, y + 7, {
          width: c.width - pad * 2,
          lineBreak: false,
        })
        x += c.width
      }
      d.rect(this.left, y + 22, this.width, 2).fill(opts.accent ?? ORANGE)
      d.y = y + 24
    }
    this.ensure(70)
    header()
    if (!rows.length) {
      d.rect(this.left, d.y, this.width, 24).strokeColor(LINE).lineWidth(0.5).stroke()
      d.fillColor(INK)
        .font('Helvetica')
        .fontSize(9)
        .text(opts.empty ?? 'Nenhum registro.', this.left + pad, d.y + 8, {
          width: this.width - pad * 2,
        })
      d.y += 30
      return
    }
    rows.forEach((row, i) => {
      d.font('Helvetica').fontSize(9)
      const heights = row.map((cell, j) => d.heightOfString(cell.text, { width: cols[j]!.width - pad * 2 }))
      const h = Math.max(...heights) + 12
      if (d.y + h > this.bottom) {
        this.page()
        header()
      }
      const y = d.y
      if (i % 2 === 1) d.rect(this.left, y, this.width, h).fill(CREAM)
      let x = this.left
      row.forEach((cell, j) => {
        d.fillColor(cell.color ?? INK)
          .font(cell.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9)
        d.text(cell.text, x + pad, y + 6, { width: cols[j]!.width - pad * 2 })
        x += cols[j]!.width
      })
      d.y = y + h
    })
    d.rect(this.left, d.y, this.width, 0.5).fill(LINE)
    d.y += 10
  }

  finish() {
    const d = this.doc
    const range = d.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i)
      // Texto dentro da margem inferior faz o PDF criar uma página nova: o rodapé é desenhado com a margem zerada
      d.page.margins.bottom = 0
      const y = d.page.height - 38
      d.rect(this.left, y - 8, this.width, 0.5).fill(LINE)
      d.fillColor(MUTED).font('Helvetica').fontSize(8)
      d.text('LATICÍNIO MAIS VIDA  |  Documento interno', this.left, y, {
        width: this.width / 2,
        lineBreak: false,
      })
      d.text(`Página ${i + 1}`, this.left + this.width / 2, y, {
        width: this.width / 2,
        align: 'right',
        lineBreak: false,
      })
      d.rect(0, d.page.height - 12, d.page.width, 6).fill(GREEN)
      d.rect(0, d.page.height - 6, d.page.width, 6).fill(ORANGE)
    }
    d.end()
    return this.done
  }
}

const NO_FALLBACK_NOTE = '* sem histórico suficiente para a referência própria - comparação feita contra a média geral.'

// ---------- Individual ----------

export function individualPdf(report: TimeReport, p: PromotorDay): Promise<Buffer> {
  const pdf = new Pdf('RELATÓRIO INDIVIDUAL DE ROTEIRO', `${periodLong(report)}  |  ${statusLine(report)}`, 'portrait')
  const d = pdf.doc
  d.fillColor(ORANGE).font('Helvetica-Bold').fontSize(26).text(p.name, pdf.left, d.y, { width: pdf.width })
  d.fillColor(MUTED)
    .font('Helvetica')
    .fontSize(11)
    .text(`${p.supervisor ? `Supervisor: ${p.supervisor}  |  ` : ''}${isRange(report) ? `Período de ${periodLong(report)}` : `Roteiro de ${fmtDateBr(report.date)}`}`, pdf.left, d.y + 2)
  d.moveDown(1)

  // Resumo do dia
  const cells: [string, string][] = [
    ['VISITAS FEITAS', `${p.visited} de ${p.total}`],
    ['SEM VISITA', String(p.notVisited)],
    ['TEMPO EM LOJA', fmtShort(p.clientSeconds)],
    ['DESLOCAMENTO', fmtShort(p.travelSeconds)],
    ...(isRange(report)
      ? []
      : ([
          ['PRIMEIRA VISITA', fmtClock(p.firstCheckin)],
          ['ÚLTIMA VISITA', fmtClock(p.lastCheckout)],
        ] as [string, string][])),
  ]
  const w = pdf.width / cells.length
  const y = d.y
  d.rect(pdf.left, y, pdf.width, 56).fill(CREAM)
  cells.forEach(([label, value], i) => {
    const x = pdf.left + i * w
    d.fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(label, x, y + 9, { width: w, align: 'center' })
    d.fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(17)
      .text(value, x, y + 25, { width: w, align: 'center' })
  })
  d.y = y + 66

  if (p.pending > 0 || p.inProgress > 0) {
    pdf.paragraph(
      `${p.inProgress ? `${p.inProgress} em atendimento agora. ` : ''}${p.pending ? `${p.pending} cliente(s) ainda a visitar. ` : ''}Os números valem até ${fmtClock(report.generatedAt)}.`,
      9.5,
      INK,
    )
  }
  if (p.outsideDay > 0) {
    pdf.paragraph(
      `Atenção: ${p.outsideDay} visita(s) contam no seu roteiro deste dia mas foram registradas em outro dia - provavelmente roteiro que ficou aberto. Elas não entram nos tempos acima.`,
      9.5,
      '#b42318',
    )
  }

  pdf.heading(`Pontos de atenção do dia - ${p.occurrences.length} ocorrência(s)`)
  const wide = pdf.width
  pdf.table(
    ...withDate(
      isRange(report),
      wide,
      [
        { label: 'CLIENTE', width: wide * 0.3 },
        { label: 'O QUE FOI', width: wide * 0.18 },
        { label: 'HORÁRIO', width: wide * 0.14 },
        { label: 'SEU TEMPO', width: wide * 0.12 },
        { label: 'MÉDIA', width: wide * 0.12 },
        { label: 'VARIAÇÃO', width: wide * 0.14 },
      ],
      p.occurrences.map((o) => [
        { text: o.clientName },
        { text: kindLabel(o), color: kindColor(o), bold: true },
        { text: when(o) },
        { text: fmtHms(o.valueSeconds) },
        { text: `${fmtHms(o.baseSeconds)}${star(o)}` },
        { text: variation(o), color: kindColor(o), bold: true },
      ]),
      p.occurrences.map((o) => o.date),
    ),
    { empty: 'Nenhum ponto fora da média neste período.' },
  )

  pdf.heading(`Clientes sem visita - ${p.notVisitedList.length} registro(s)`)
  pdf.table(
    ...withDate(
      isRange(report),
      wide,
      [
        { label: 'CLIENTE', width: wide * 0.3 },
        { label: 'CIDADE', width: wide * 0.14 },
        { label: 'MOTIVO', width: wide * 0.26 },
        { label: 'COMENTÁRIO', width: wide * 0.3 },
      ],
      p.notVisitedList.map((n) => [{ text: n.clientName }, { text: dash(n.city) }, { text: dash(n.reason) }, { text: dash(n.comment) }]),
      p.notVisitedList.map((n) => n.date),
    ),
    { accent: GREEN, empty: 'Você visitou todos os clientes do roteiro.' },
  )

  if (p.occurrences.some((o) => o.fallback)) pdf.paragraph(NO_FALLBACK_NOTE)
  pdf.paragraph(
    'Converse com seu supervisor sobre os pontos acima. Se algum apontamento estiver errado - roteiro que ficou aberto sem querer, visita registrada fora do horário - avise que a gente corrige.',
  )
  return pdf.finish()
}

// ---------- Consolidado ----------

export function consolidatedPdf(report: TimeReport): Promise<Buffer> {
  const pdf = new Pdf('RELATÓRIO CONSOLIDADO DE ROTEIROS', `${periodLong(report)}  |  ${statusLine(report)}`, 'landscape')
  const d = pdf.doc
  const days = report.promotores
  const all = days.flatMap((p) => p.occurrences.map((o) => ({ p, o })))
  const visited = days.reduce((s, p) => s + p.visited, 0)
  const total = days.reduce((s, p) => s + p.total, 0)

  d.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`${days.length} promotor(es)  |  ${visited} de ${total} visitas feitas  |  ${all.length} ocorrência(s)`, pdf.left, d.y)
  d.moveDown(0.3)
  for (const w of report.warnings) pdf.paragraph(w, 9, '#b42318')
  if (report.isToday) pdf.paragraph(`${isRange(report) ? 'Período em andamento' : 'Dia em andamento'}: os números valem até ${fmtClock(report.generatedAt)}.`, 9, INK)
  if (report.baseline) pdf.paragraph(`Referência: médias de ${fmtDateBr(report.baseline.from)} a ${fmtDateBr(report.baseline.to)} (${report.baseline.observations} visitas).`)

  const W = pdf.width
  const sorted = (pick: (o: Occurrence) => boolean) => all.filter(({ o }) => pick(o)).sort((a, b) => a.p.name.localeCompare(b.p.name, 'pt-BR') || a.o.date.localeCompare(b.o.date) || Math.abs(b.o.diffSeconds) - Math.abs(a.o.diffSeconds))

  const section = (title: string, color: string, items: { p: PromotorDay; o: Occurrence }[], baseLabel: string) => {
    pdf.heading(`${title} - ${items.length}`, color)
    pdf.table(
      ...withDate(
        isRange(report),
        W,
        [
          { label: 'PROMOTOR', width: W * 0.13 },
          { label: 'CLIENTE', width: W * 0.23 },
          { label: 'CIDADE', width: W * 0.11 },
          { label: 'HORÁRIO', width: W * 0.1 },
          { label: 'TEMPO DO DIA', width: W * 0.1 },
          { label: baseLabel, width: W * 0.15 },
          { label: 'DIFERENÇA', width: W * 0.09 },
          { label: 'VARIAÇÃO', width: W * 0.09 },
        ],
        items.map(({ p, o }) => [
          { text: p.name, bold: true },
          { text: o.clientName },
          { text: dash(o.city) },
          { text: when(o) },
          { text: fmtHms(o.valueSeconds) },
          { text: `${fmtHms(o.baseSeconds)}${star(o)}` },
          { text: fmtDiff(o.diffSeconds), color, bold: true },
          {
            text: `${o.ratio >= 100 ? '99+' : o.ratio.toFixed(1)}x`,
            color,
            bold: true,
          },
        ]),
        items.map(({ o }) => o.date),
      ),
      { accent: color, empty: 'Nenhuma ocorrência.' },
    )
  }

  section(
    '1. Tempo no roteiro acima da média',
    ORANGE,
    sorted((o) => o.kind === 'ROTEIRO' && o.direction === 'ACIMA'),
    'MÉDIA DO CLIENTE',
  )
  section(
    '2. Tempo no roteiro abaixo da média',
    BLUE,
    sorted((o) => o.kind === 'ROTEIRO' && o.direction === 'ABAIXO'),
    'MÉDIA DO CLIENTE',
  )
  section(
    '3. Tempo de deslocamento acima da média',
    ORANGE,
    sorted((o) => o.kind === 'DESLOCAMENTO'),
    'MÉDIA DO TRAJETO',
  )

  const notVisited = days.flatMap((p) => p.notVisitedList.map((n) => ({ p, n }))).sort((a, b) => a.p.name.localeCompare(b.p.name, 'pt-BR') || a.n.date.localeCompare(b.n.date) || a.n.clientName.localeCompare(b.n.clientName, 'pt-BR'))
  pdf.heading(`4. Clientes não visitados - ${notVisited.length}`, GREEN)
  pdf.table(
    ...withDate(
      isRange(report),
      W,
      [
        { label: 'PROMOTOR', width: W * 0.14 },
        { label: 'CLIENTE', width: W * 0.25 },
        { label: 'CIDADE', width: W * 0.11 },
        { label: 'MOTIVO', width: W * 0.19 },
        { label: 'JUSTIFICATIVA', width: W * 0.19 },
        { label: 'STATUS', width: W * 0.12 },
      ],
      notVisited.map(({ p, n }) => [{ text: p.name, bold: true }, { text: n.clientName }, { text: dash(n.city) }, { text: dash(n.reason) }, { text: dash(n.comment) }, { text: stateLabel[n.state] }]),
      notVisited.map(({ n }) => n.date),
    ),
    { accent: GREEN, empty: 'Todos os clientes do roteiro foram visitados.' },
  )

  if (all.some(({ o }) => o.fallback)) pdf.paragraph(NO_FALLBACK_NOTE)
  return pdf.finish()
}
