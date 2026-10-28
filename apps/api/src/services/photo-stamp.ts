import sharp from 'sharp'
import type { PhotoType } from '../db'
import { env } from '../env'
import { badRequest } from '../lib/errors'
import { photoTypeLabels } from './settings'

const MAX_SIDE = 2048

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

export function stampDate(date: Date) {
  return date
    .toLocaleString('pt-BR', { timeZone: env.timezone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(',', '')
}

/**
 * Grava na própria imagem a data e hora, o tipo da foto, o cliente e o promotor (faixa no rodapé).
 * Feito no servidor com o horário registrado da foto (nunca posterior ao recebimento), então vale
 * para qualquer versão do app. Também corrige a orientação (EXIF) e limita o lado maior a 2048 px.
 */
export async function stampPhoto(
  buffer: Buffer,
  info: { takenAt: Date; type: PhotoType; clientName: string; clientCode?: string | null; promotorName: string },
): Promise<Buffer> {
  let base: { data: Buffer; info: { width: number; height: number } }
  let format: string | undefined
  try {
    format = (await sharp(buffer).metadata()).format
    base = await sharp(buffer).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true })
  } catch {
    throw badRequest('Não foi possível ler a imagem enviada. Tire a foto de novo.', 'IMAGEM_INVALIDA')
  }
  const { width, height } = base.info
  const bar = Math.max(56, Math.round(Math.min(width, height) * 0.11))
  const font = Math.round(bar * 0.34)
  const pad = Math.round(font * 0.6)
  const charsPerLine = Math.floor((width - pad * 2) / (font * 0.5))

  const line1 = `${stampDate(info.takenAt)} · ${photoTypeLabels[info.type]}`
  const line2 = truncate(`${info.clientCode ? `${info.clientCode} ` : ''}${info.clientName} · ${info.promotorName}`, charsPerLine)
  const svg = `<svg width="${width}" height="${bar}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.62)"/>
  <text x="${pad}" y="${Math.round(font * 1.25)}" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-size="${font}" font-weight="700" fill="#F5C518">${esc(line1)}</text>
  <text x="${pad}" y="${Math.round(font * 2.5)}" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-size="${Math.round(font * 0.85)}" fill="#FFFFFF">${esc(line2)}</text>
</svg>`

  const stamped = sharp(base.data).composite([{ input: Buffer.from(svg), gravity: 'south' }])
  if (format === 'png') return stamped.png().toBuffer()
  if (format === 'webp') return stamped.webp({ quality: 85 }).toBuffer()
  return stamped.jpeg({ quality: 85 }).toBuffer()
}
