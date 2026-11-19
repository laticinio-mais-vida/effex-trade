import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)

/**
 * Converte o PDF em JPEG (poppler-utils, "pdftoppm", instalado na imagem Docker). Com várias páginas, empilha uma abaixo da
 * outra numa imagem só, para mandar de uma vez (ex.: pelo WhatsApp).
 */
export async function pdfToJpeg(pdf: Buffer, dpi = 110): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'effex-pdf-'))
  try {
    await writeFile(join(dir, 'in.pdf'), pdf)
    try {
      await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=88', '-r', String(dpi), join(dir, 'in.pdf'), join(dir, 'page')])
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('O conversor de PDF para imagem (poppler-utils) não está instalado no servidor.')
      throw e
    }
    const files = (await readdir(dir)).filter((f) => f.startsWith('page') && f.endsWith('.jpg')).sort()
    const pages = await Promise.all(files.map((f) => readFile(join(dir, f))))
    if (pages.length === 1) return pages[0]!
    const metas = await Promise.all(pages.map((p) => sharp(p).metadata()))
    const width = Math.max(...metas.map((m) => m.width ?? 0))
    const height = metas.reduce((s, m) => s + (m.height ?? 0), 0)
    let top = 0
    const layers = pages.map((input, i) => {
      const layer = { input, top, left: 0 }
      top += metas[i]!.height ?? 0
      return layer
    })
    return sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(layers).jpeg({ quality: 88 }).toBuffer()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
