import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../auth'
import { prisma } from '../db'
import { parse, zLat, zLng } from '../lib/validate'

export async function trackingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('PROMOTOR'))

  /** O app envia a posição a cada N minutos; pings acumulados offline chegam em lote. */
  app.post('/pings', async (req) => {
    const body = parse(
      z.object({
        pings: z
          .array(
            z.object({
              latitude: zLat,
              longitude: zLng,
              accuracy: z.number().nonnegative().optional(),
              mocked: z.boolean().optional(),
              battery: z.number().min(0).max(1).optional(),
              recordedAt: z.iso.datetime({ offset: true }),
            }),
          )
          .min(1)
          .max(500),
      }),
      req.body,
    )
    const now = Date.now()
    const valid = body.pings.filter((p) => new Date(p.recordedAt).getTime() <= now + 5 * 60_000)
    const { count } = await prisma.locationPing.createMany({
      data: valid.map((p) => ({ ...p, promotorId: req.user.sub, recordedAt: new Date(p.recordedAt), mocked: p.mocked ?? false })),
    })
    return { received: count }
  })
}
