import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { env } from '../env'

/**
 * Armazenamento de fotos em disco local. Para produção, troque por S3/R2/GCS mantendo
 * a mesma interface (saveUpload / publicUrl / absolutePath / removeUpload).
 */
export async function saveUpload(buffer: Buffer, extension: string) {
  const now = new Date()
  const relative = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${extension}`
  const target = absolutePath(relative)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer)
  return relative
}

export function absolutePath(relative: string) {
  return join(env.uploadDir, ...relative.split('/'))
}

export function publicUrl(relative: string) {
  return `/uploads/${relative}`
}

export async function removeUpload(relative: string) {
  await rm(absolutePath(relative), { force: true })
}

export const imageExtensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}
