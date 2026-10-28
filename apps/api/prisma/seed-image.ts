import { deflateSync } from 'node:zlib'

/**
 * Gera imagens PNG de exemplo (uma "gôndola" desenhada) para as fotos do seed,
 * sem depender de bibliotecas nativas.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width: number, height: number, rgb: Uint8Array) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Kind = 'FACHADA' | 'ANTES' | 'DEPOIS' | 'RUPTURA' | 'VENCIMENTO' | 'ATIVIDADE_EXTRA'

const SIGN_COLORS: [number, number, number][] = [
  [20, 60, 120],
  [160, 30, 40],
  [10, 110, 80],
  [120, 50, 130],
]

const PRODUCT_COLORS: [number, number, number][] = [
  [235, 240, 245], // leite
  [250, 214, 165], // doce de leite
  [240, 128, 160], // iogurte morango
  [140, 190, 230], // bebida láctea
  [250, 235, 150], // manteiga
  [200, 230, 180], // requeijão
]

export function shelfPng(seed: number, kind: Kind, width = 480, height = 360) {
  const rand = mulberry32(seed)
  const px = new Uint8Array(width * height * 3)
  const fill = (x0: number, y0: number, w: number, h: number, [r, g, b]: [number, number, number]) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) {
        const i = (y * width + x) * 3
        px[i] = r
        px[i + 1] = g
        px[i + 2] = b
      }
    }
  }

  if (kind === 'FACHADA') {
    // Fachada da loja: céu, parede, letreiro, toldo listrado, porta e vitrines
    const sign = SIGN_COLORS[Math.floor(rand() * SIGN_COLORS.length)]!
    fill(0, 0, width, height, [170, 205, 235])
    fill(20, 50, width - 40, height - 90, [232, 226, 214])
    fill(20, 62, width - 40, 46, sign)
    fill(width / 2 - 110, 74, 220, 22, [255, 255, 255])
    for (let x = 20, i = 0; x < width - 20; x += 28, i++) fill(x, 108, 28, 30, i % 2 ? [255, 255, 255] : sign)
    fill(width / 2 - 45, 170, 90, height - 210, [60, 70, 80])
    fill(width / 2 - 3, 175, 6, height - 220, [120, 130, 140])
    for (const x of [45, width - 175]) {
      fill(x, 170, 130, 110, [80, 90, 100])
      fill(x + 6, 176, 118, 98, [130, 170, 200])
    }
    fill(0, height - 40, width, 40, [150, 150, 150])
    return encodePng(width, height, px)
  }

  fill(0, 0, width, height, [62, 70, 82]) // fundo da gôndola
  const shelves = 4
  const shelfH = Math.floor(height / shelves)
  const gapStart = kind === 'RUPTURA' ? Math.floor(width * (0.3 + rand() * 0.3)) : -1
  const gapShelf = Math.floor(rand() * shelves)
  const density = kind === 'ANTES' ? 0.55 : kind === 'DEPOIS' || kind === 'ATIVIDADE_EXTRA' ? 0.95 : 0.85

  for (let s = 0; s < shelves; s++) {
    const baseY = (s + 1) * shelfH - 10
    fill(0, baseY, width, 10, [190, 196, 204]) // prateleira
    let x = 6
    const color = PRODUCT_COLORS[Math.floor(rand() * PRODUCT_COLORS.length)]!
    while (x < width - 30) {
      const w = 22 + Math.floor(rand() * 14)
      const h = Math.floor(shelfH * (0.45 + rand() * 0.35))
      const isGap = s === gapShelf && gapStart >= 0 && x > gapStart && x < gapStart + 140
      if (!isGap && rand() < density) {
        const c = kind === 'ANTES' && rand() < 0.4 ? PRODUCT_COLORS[Math.floor(rand() * PRODUCT_COLORS.length)]! : color
        fill(x, baseY - h, w, h, c)
        fill(x + 3, baseY - h + 6, w - 6, 5, [90, 98, 110]) // rótulo
        if (kind === 'VENCIMENTO' && s === gapShelf && rand() < 0.35) fill(x, baseY - h, w, 8, [220, 50, 47]) // etiqueta de vencido
      }
      x += w + 4
    }
  }
  if (kind === 'ATIVIDADE_EXTRA') {
    fill(0, 0, width, 34, [0, 122, 94]) // faixa de campanha
    fill(width / 2 - 70, 8, 140, 18, [255, 255, 255])
  }
  return encodePng(width, height, px)
}
