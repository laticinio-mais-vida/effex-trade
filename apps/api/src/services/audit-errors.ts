import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { prisma } from '../db'
import { env } from '../env'
import { fromDbDate, localDayRange } from '../lib/dates'
import { notFound } from '../lib/errors'
import { photoTypeLabels } from './settings'
import { absolutePath, publicUrl } from './storage'

/** Auditorias do vendedor no período e as que o supervisor marcou como incorretas. */
export async function auditErrorsData(vendedorId: string, from: string, to: string) {
  const vendedor = await prisma.user.findUnique({ where: { id: vendedorId }, select: { id: true, name: true, role: true, supervisor: { select: { name: true } } } })
  if (!vendedor || vendedor.role !== 'VENDEDOR') throw notFound('Vendedor')

  const audits = await prisma.photoAudit.findMany({
    where: { auditorId: vendedorId, createdAt: { gte: localDayRange(from).start, lt: localDayRange(to).end } },
    include: {
      review: { include: { supervisor: { select: { name: true } } } },
      photo: { include: { visit: { include: { client: true, promotor: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const reviewed = audits.filter((a) => a.review)
  const incorrect = reviewed.filter((a) => a.review!.verdict === 'INCORRETA')
  return {
    vendedor: { id: vendedor.id, name: vendedor.name, supervisor: vendedor.supervisor?.name ?? null },
    from,
    to,
    stats: {
      audited: audits.length,
      reviewed: reviewed.length,
      incorrect: incorrect.length,
      accuracy: reviewed.length ? Math.round(((reviewed.length - incorrect.length) / reviewed.length) * 1000) / 10 : null,
    },
    items: incorrect.map((a) => ({
      auditId: a.id,
      vendedorStatus: a.status,
      vendedorJustification: a.justification,
      auditedAt: a.createdAt,
      correctStatus: a.status === 'APROVADA' ? 'REPROVADA' : 'APROVADA',
      supervisorComment: a.review!.comment,
      supervisor: a.review!.supervisor.name,
      reviewedAt: a.review!.createdAt,
      photo: {
        id: a.photo.id,
        type: a.photo.type,
        url: publicUrl(a.photo.path),
        path: a.photo.path,
        takenAt: a.photo.takenAt,
        notes: a.photo.notes,
      },
      visitDate: fromDbDate(a.photo.visit.date),
      client: { name: a.photo.visit.client.name, code: a.photo.visit.client.code, city: a.photo.visit.client.city },
      promotor: a.photo.visit.promotor.name,
    })),
  }
}

const fmtDate = (d: Date | string) =>
  typeof d === 'string' ? d.split('-').reverse().join('/') : d.toLocaleDateString('pt-BR', { timeZone: env.timezone })
const fmtDateTime = (d: Date) => d.toLocaleString('pt-BR', { timeZone: env.timezone, dateStyle: 'short', timeStyle: 'short' })
const statusLabel = (s: string) => (s === 'APROVADA' ? 'Aprovada' : 'Reprovada')

const INK = '#1f2933'
const MUTED = '#616e7c'
const LINE = '#d9dee4'
const RED = '#b42318'
const GREEN = '#067647'

/** PDF para enviar ao vendedor com as auditorias que ele fez de forma incorreta. */
export async function auditErrorsPdf(vendedorId: string, from: string, to: string): Promise<Buffer> {
  const data = await auditErrorsData(vendedorId, from, to)
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Correções de auditoria - ${data.vendedor.name}` } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('Correções de auditoria de fotos', left, 40)
  doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor(MUTED)
  doc.text(`Vendedor: ${data.vendedor.name}${data.vendedor.supervisor ? `   ·   Supervisor: ${data.vendedor.supervisor}` : ''}`)
  doc.text(`Período: ${fmtDate(from)} a ${fmtDate(to)}   ·   Emitido em ${fmtDateTime(new Date())}`)

  // Indicadores
  const stats = [
    ['Fotos auditadas', String(data.stats.audited)],
    ['Conferidas pelo supervisor', String(data.stats.reviewed)],
    ['Auditorias incorretas', String(data.stats.incorrect)],
    ['Taxa de acerto', data.stats.accuracy == null ? '—' : `${String(data.stats.accuracy).replace('.', ',')}%`],
  ] as const
  const boxW = (width - 3 * 8) / 4
  const boxY = doc.y + 14
  stats.forEach(([label, value], i) => {
    const x = left + i * (boxW + 8)
    doc.roundedRect(x, boxY, boxW, 52, 4).strokeColor(LINE).lineWidth(1).stroke()
    doc.fillColor(i === 2 && data.stats.incorrect > 0 ? RED : INK).font('Helvetica-Bold').fontSize(16).text(value, x + 10, boxY + 9, { width: boxW - 20 })
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label, x + 10, boxY + 32, { width: boxW - 20 })
  })
  doc.y = boxY + 70

  if (data.items.length === 0) {
    doc.fillColor(INK).font('Helvetica').fontSize(11).text('Nenhuma auditoria incorreta no período. Parabéns!', left, doc.y, { width })
  } else {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(`Auditorias a corrigir (${data.items.length})`, left, doc.y)
    doc.moveDown(0.5)
  }

  const imgW = 150
  const imgH = 112
  const blockH = imgH + 20
  for (const item of data.items) {
    if (doc.y + blockH > doc.page.height - doc.page.margins.bottom - 20) doc.addPage()
    const top = doc.y
    doc.moveTo(left, top).lineTo(left + width, top).strokeColor(LINE).stroke()
    const y = top + 10

    const file = absolutePath(item.photo.path)
    if (existsSync(file)) {
      try {
        doc.image(file, left, y, { fit: [imgW, imgH], align: 'center', valign: 'center' })
      } catch {
        doc.rect(left, y, imgW, imgH).fillColor('#f2f4f7').fill()
      }
    } else {
      doc.rect(left, y, imgW, imgH).fillColor('#f2f4f7').fill()
      doc.fillColor(MUTED).fontSize(8).text('Foto indisponível', left, y + imgH / 2 - 4, { width: imgW, align: 'center' })
    }

    const tx = left + imgW + 14
    const tw = width - imgW - 14
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`${item.client.code ? `${item.client.code} · ` : ''}${item.client.name}`, tx, y, { width: tw })
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    doc.text(`Foto: ${photoTypeLabels[item.photo.type]}   ·   Visita: ${fmtDate(item.visitDate)}   ·   Promotor: ${item.promotor}`, { width: tw })
    doc.moveDown(0.4)
    doc.fillColor(INK).font('Helvetica-Bold').text('Sua auditoria: ', { continued: true, width: tw })
    doc.font('Helvetica').fillColor(item.vendedorStatus === 'APROVADA' ? GREEN : RED).text(statusLabel(item.vendedorStatus), { continued: !!item.vendedorJustification })
    if (item.vendedorJustification) doc.fillColor(MUTED).text(` — "${item.vendedorJustification}"`)
    doc.fillColor(INK).font('Helvetica-Bold').text('Correto seria: ', { continued: true, width: tw })
    doc.font('Helvetica').fillColor(item.correctStatus === 'APROVADA' ? GREEN : RED).text(statusLabel(item.correctStatus))
    if (item.supervisorComment) {
      doc.fillColor(INK).font('Helvetica-Bold').text('Orientação do supervisor: ', { continued: true, width: tw })
      doc.font('Helvetica').fillColor(INK).text(item.supervisorComment)
    }
    doc.fillColor(MUTED).fontSize(8).text(`Conferido por ${item.supervisor} em ${fmtDateTime(item.reviewedAt)}`, { width: tw })
    doc.y = Math.max(doc.y, y + imgH) + 10
  }

  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`EFFEX Trade · página ${i + 1} de ${range.count}`, left, doc.page.height - 28, { width, align: 'right' })
    doc.page.margins.bottom = bottom
  }
  doc.end()
  return done
}
