import type { FastifyRequest } from 'fastify'
import { imageExtensions } from '../services/storage'
import { badRequest } from './errors'

export type UploadedImage = { buffer: Buffer; extension: string }

/** Lê um formulário multipart com no máximo uma imagem no campo "file" e campos de texto. */
export async function readImageForm(req: FastifyRequest) {
  const fields: Record<string, string> = {}
  let file: UploadedImage | null = null
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      // Alguns aparelhos mandam tipo genérico (application/octet-stream): usa a extensão do arquivo
      const byName = part.filename?.toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[1]
      const extension = imageExtensions[part.mimetype] ?? (byName ? (byName === 'jpeg' ? '.jpg' : `.${byName}`) : undefined)
      const buffer = await part.toBuffer()
      if (!extension) throw badRequest(`Formato de imagem não suportado: ${part.mimetype}`)
      file = { buffer, extension }
    } else if (typeof part.value === 'string' && part.value !== '') {
      fields[part.fieldname] = part.value
    }
  }
  return { fields, file }
}

/** Converte um campo JSON de formulário (ex.: productIds='["a","b"]'). */
export function jsonField<T>(value: string | undefined, name: string): T | undefined {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    throw badRequest(`O campo ${name} precisa ser um JSON válido.`)
  }
}
