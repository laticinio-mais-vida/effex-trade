import { notFound } from '../lib/errors'
import { pdfToJpeg } from './pdf-image'
import type { TimeReport } from './time-report'
import { consolidatedPdf, individualPdf } from './time-report-pdf'

export type TimeFileFormat = 'pdf' | 'jpeg'

const slug = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** Arquivo do relatório de tempos do dia: individual (um promotor, já filtrado no relatório) ou consolidado, em PDF ou JPEG. */
export async function timeReportFile(report: TimeReport, opts: { individual: boolean; format: TimeFileFormat }) {
  if (!report.promotores.length) throw notFound('Roteiro')
  const br = (d: string) => d.split('-').reverse().join('-')
  const day = report.dateTo === report.date ? br(report.date) : `${br(report.date)}_a_${br(report.dateTo)}`
  const status = report.isToday ? 'ANDAMENTO' : 'FECHADO'
  const first = report.promotores[0]!
  const pdf = opts.individual ? await individualPdf(report, first) : await consolidatedPdf(report)
  const base = opts.individual ? `Roteiro_${slug(first.name)}_${day}_${status}` : `Roteiros_consolidado_${day}_${status}`
  return opts.format === 'jpeg'
    ? { buffer: await pdfToJpeg(pdf), contentType: 'image/jpeg', name: `${base}.jpg` }
    : { buffer: pdf, contentType: 'application/pdf', name: `${base}.pdf` }
}
