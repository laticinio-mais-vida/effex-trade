import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../env'

/**
 * Atualizações do app (protocolo expo-updates v1: https://docs.expo.dev/technical-specs/expo-updates-1/), sem o EAS.
 * O deploy/atualizar-app.ps1 grava cada publicação numa pasta UPDATES_DIR/<plataforma>/<runtime>/<entrada>, com o
 * nome começando pela data e hora (UTC); vale a mais recente:
 * - manifest.json: atualização. O bundle e os assets ficam na pasta (ou na de uma publicação anterior, quando ela é
 *   republicada) e saem por /updates/files/ (app.ts), com URLs relativas a /updates/manifest.
 * - directive.json: volta todos para o código que veio no APK (rollBackToEmbedded).
 * Sem nada novo para o aparelho, a resposta é 204 e o app segue com o que tem.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

export async function updatesRoutes(app: FastifyInstance) {
  app.get('/manifest', async (req, reply) => {
    const platform = req.headers['expo-platform']
    const runtime = req.headers['expo-runtime-version']
    if ((platform !== 'android' && platform !== 'ios') || typeof runtime !== 'string' || !SAFE_SEGMENT.test(runtime)) {
      return reply.status(400).send({ error: 'Envie os cabeçalhos expo-platform e expo-runtime-version.', code: 'REQUISICAO_INVALIDA' })
    }
    reply.header('expo-protocol-version', 1).header('expo-sfv-version', 0).header('cache-control', 'private, max-age=0')

    const folder = join(env.updatesDir, platform, runtime)
    const entry = await latestEntry(folder)
    if (!entry) return reply.status(204).send()
    const current = String(req.headers['expo-current-update-id'] ?? '').toLowerCase()

    const manifest = await readJson(join(folder, entry, 'manifest.json'))
    if (manifest) {
      if (String(manifest.id).toLowerCase() === current) return reply.status(204).send()
      return reply.type('application/json').send(manifest)
    }

    const directive = await readJson(join(folder, entry, 'directive.json'))
    if (directive && current !== String(req.headers['expo-embedded-update-id'] ?? '').toLowerCase()) {
      const boundary = randomUUID()
      return reply
        .type(`multipart/mixed; boundary=${boundary}`)
        .send(
          `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Disposition: inline; name="directive"\r\n\r\n` +
            `${JSON.stringify(directive)}\r\n--${boundary}--\r\n`,
        )
    }
    if (!directive) req.log.warn({ folder, entry }, 'publicação do app sem manifest.json nem directive.json')
    return reply.status(204).send()
  })
}

/** Publicação mais recente do runtime. Pastas com ponto no início ainda estão sendo copiadas. */
async function latestEntry(folder: string) {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
      .at(-1)
  } catch {
    return undefined // nenhuma publicação para este runtime
  }
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}
