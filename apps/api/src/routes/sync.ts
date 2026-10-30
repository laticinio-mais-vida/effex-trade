import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env'
import { badRequest, HttpError } from '../lib/errors'
import { parse } from '../lib/validate'
import { syncErpClients } from '../services/erp-sync'

/**
 * Recebe os clientes do ERP mandados pelo computador da empresa (sync/sincronizar-clientes.bat). Não usa login: o
 * pacote vem assinado com HMAC-SHA256 da hora do envio e do hash do corpo, com a SYNC_KEY que só o servidor e o
 * sync/config.ini conhecem (o mesmo esquema do BI Mais Vida). A chave nunca trafega.
 */

/** Diferença aceita entre o relógio do computador que envia e o do servidor. */
const TOLERANCE_MS = 15 * 60_000
const MAX_PACKAGE = 10 * 1024 * 1024
const MAX_JSON = 100 * 1024 * 1024

export function signSync(key: string, sentAt: string, body: Buffer) {
  const hash = createHash('sha256').update(body).digest('hex')
  return createHmac('sha256', key).update(`${sentAt}\n${hash}`).digest('hex')
}

const zText = z.string().max(500).nullish()

const syncBody = z.object({
  /** Data do arquivo da cópia do banco no computador que enviou */
  sourceModifiedAt: z.coerce.date().nullish(),
  /** Confirma uma inativação em massa (sync/sincronizar.py --forcar) */
  force: z.boolean().optional(),
  clients: z
    .array(
      z.object({
        erpId: z.number().int().positive().max(2_147_483_647),
        name: zText,
        legalName: zText,
        city: zText,
        state: zText,
        active: z.boolean(),
        // Coordenada fora dos limites não recusa o envio: o cliente fica sem a localização do ERP, com aviso
        latitude: z.number().nullish(),
        longitude: z.number().nullish(),
      }),
    )
    .min(1, 'o envio veio sem clientes')
    .max(100_000),
})

export async function syncRoutes(app: FastifyInstance) {
  // Só neste plugin: o pacote chega compactado, e a assinatura é conferida sobre os bytes recebidos
  app.addContentTypeParser('application/gzip', { parseAs: 'buffer', bodyLimit: MAX_PACKAGE }, (_req, body, done) => done(null, body))

  const limit = {
    bodyLimit: MAX_PACKAGE,
    config: {
      rateLimit: {
        max: 12,
        timeWindow: '1 minute',
        errorResponseBuilder: () => new HttpError(429, 'Muitos envios seguidos. Aguarde um minuto e rode de novo.', 'MUITAS_TENTATIVAS'),
      },
    },
  }

  app.post('/clientes', limit, async (req) => {
    if (!env.syncKey) throw new HttpError(503, 'Sincronização desligada: falta a SYNC_KEY no servidor.', 'SINCRONIZACAO_DESLIGADA')
    if (!Buffer.isBuffer(req.body)) throw badRequest('Envie o pacote compactado (Content-Type: application/gzip).', 'PACOTE_INVALIDO')

    const sentAt = String(req.headers['x-effex-data'] ?? '')
    if (!/^\d{9,11}$/.test(sentAt) || Math.abs(Date.now() - Number(sentAt) * 1000) > TOLERANCE_MS) {
      throw new HttpError(401, 'O relógio do computador que envia está mais de 15 minutos diferente do servidor (acerte a hora do Windows).', 'RELOGIO')
    }
    const expected = Buffer.from(signSync(env.syncKey, sentAt, req.body))
    const received = Buffer.from(String(req.headers['x-effex-assinatura'] ?? ''))
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new HttpError(401, 'Assinatura inválida: a chave do sync/config.ini não é a mesma do servidor (ou o pacote foi alterado no caminho).', 'ASSINATURA_INVALIDA')
    }

    // Só descompacta depois da assinatura: quem não tem a chave não consegue mandar um pacote que explode na memória
    let payload: unknown
    try {
      payload = JSON.parse(gunzipSync(req.body, { maxOutputLength: MAX_JSON }).toString('utf8'))
    } catch {
      throw badRequest('Pacote corrompido: não foi possível descompactar.', 'PACOTE_INVALIDO')
    }
    const result = await syncErpClients(parse(syncBody, payload), { sentAt: new Date(Number(sentAt) * 1000), ip: req.ip })
    req.log.info({ sync: { ...result, warnings: result.warnings.length } }, 'clientes do ERP sincronizados')
    return result
  })
}
