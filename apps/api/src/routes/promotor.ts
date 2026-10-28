import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../auth'
import { PhotoType, prisma } from '../db'
import { toDbDate, todayIn } from '../lib/dates'
import { badRequest } from '../lib/errors'
import { jsonField, readImageForm } from '../lib/multipart'
import { parse, zDate, zId, zIdParam, zLat, zLng, zLocation } from '../lib/validate'
import {
  cancelPermissionRequest,
  createPermissionRequest,
  listPermissionTypes,
  requestInclude,
  serializeRequest,
} from '../services/permissions'
import { serializeClient } from '../services/serializers'
import { getSettings } from '../services/settings'
import {
  addExtraVisit,
  addPhoto,
  checkin,
  checkout,
  completeTask,
  confirmRupture,
  deletePhoto,
  endDay,
  getDayForPromotor,
  getRupture,
  getVisitDetail,
  justify,
  listProductsForVisit,
  removeExtraVisit,
  reopenVisit,
  setPhotoProducts,
  startLunch,
} from '../services/visits'

const zOptionalLocation = zLocation
  .partial()
  .refine((b) => (b.latitude == null) === (b.longitude == null), { message: 'informe latitude e longitude juntas', path: ['latitude'] })

function toLocation(b: z.infer<typeof zOptionalLocation>) {
  return b.latitude != null && b.longitude != null ? { ...b, latitude: b.latitude, longitude: b.longitude } : null
}

/** Campos de localização enviados como texto num formulário multipart. */
const zFormLocation = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().nonnegative().optional(),
  mocked: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  takenAt: z.iso.datetime({ offset: true }).optional(),
})

export async function promotorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('PROMOTOR'))

  app.get('/day', async (req) => {
    const q = parse(z.object({ date: zDate.optional() }), req.query)
    return getDayForPromotor(req.user.sub, q.date ?? todayIn())
  })

  // Não existe "iniciar roteiro": o roteiro começa na abertura do primeiro atendimento.
  app.post('/day/end', async (req) => {
    const body = parse(
      z.object({
        latitude: zLat.optional(),
        longitude: zLng.optional(),
        justifications: z.array(z.object({ visitId: zId, reasonId: zId, text: z.string().max(2000).optional() })).max(200).default([]),
      }),
      req.body,
    )
    const location = body.latitude != null && body.longitude != null ? { latitude: body.latitude, longitude: body.longitude } : null
    return endDay(req.user.sub, { location, justifications: body.justifications })
  })

  /** Abre o almoço. A volta é a abertura (ou justificativa) do próximo cliente. */
  app.post('/lunch/start', async (req) => startLunch(req.user.sub, toLocation(parse(zOptionalLocation, req.body))))

  /** Produtos para identificar nas fotos de depois (só o mix do cliente da visita). */
  app.get('/products', async (req) => {
    const q = parse(z.object({ visitId: zId.optional(), search: z.string().trim().optional() }), req.query)
    return listProductsForVisit(req.user.sub, q.visitId, q.search)
  })

  /** Busca de clientes para incluir como extra ou pedir substituição. */
  app.get('/clients', async (req) => {
    const q = parse(z.object({ search: z.string().trim().optional() }), req.query)
    const settings = await getSettings(req.user.sub)
    const clients = await prisma.client.findMany({
      where: {
        active: true,
        ...(q.search
          ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { tradeName: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search } }, { city: { contains: q.search, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
    })
    return clients.map((c) => serializeClient(c, settings.geofenceRadiusMeters))
  })

  app.post('/visits', async (req) => {
    const body = parse(z.object({ clientId: zId }), req.body)
    return addExtraVisit(req.user.sub, body.clientId)
  })

  app.get('/visits/:id', async (req) => getVisitDetail(req.user.sub, parse(zIdParam, req.params).id))

  app.delete('/visits/:id', async (req) => {
    await removeExtraVisit(req.user.sub, parse(zIdParam, req.params).id)
    return { ok: true }
  })

  /**
   * Abertura do atendimento. Multipart com a foto da fachada no campo "file" e a localização em
   * latitude, longitude, accuracy, mocked, takenAt. Sem a regra da fachada, aceita também JSON.
   */
  app.post('/visits/:id/checkin', async (req) => {
    const { id } = parse(zIdParam, req.params)
    if (req.isMultipart()) {
      const { fields, file } = await readImageForm(req)
      const { takenAt, ...loc } = parse(zFormLocation, fields)
      return checkin(req.user.sub, id, loc, file ? { ...file, takenAt: takenAt ? new Date(takenAt) : undefined } : null)
    }
    return checkin(req.user.sub, id, parse(zLocation, req.body), null)
  })

  /** Reabre um cliente já atendido hoje (mesmo formato do check-in: localização + foto da fachada). */
  app.post('/visits/:id/reopen', async (req) => {
    const { id } = parse(zIdParam, req.params)
    if (req.isMultipart()) {
      const { fields, file } = await readImageForm(req)
      const { takenAt, ...loc } = parse(zFormLocation, fields)
      return reopenVisit(req.user.sub, id, loc, file ? { ...file, takenAt: takenAt ? new Date(takenAt) : undefined } : null)
    }
    return reopenVisit(req.user.sub, id, parse(zLocation, req.body), null)
  })

  app.post('/visits/:id/checkout', async (req) => {
    const { notes, ...loc } = parse(zOptionalLocation.and(z.object({ notes: z.string().max(2000).optional() })), req.body)
    return checkout(req.user.sub, parse(zIdParam, req.params).id, toLocation(loc), notes)
  })

  /** Conclui uma atividade extra que não exige foto. */
  app.post('/visits/:id/tasks/:taskId/complete', async (req) => {
    const params = parse(z.object({ id: zId, taskId: zId }), req.params)
    const body = parse(z.object({ notes: z.string().max(1000).optional() }), req.body)
    return completeTask(req.user.sub, params.id, params.taskId, body.notes)
  })

  app.get('/visits/:id/rupture', async (req) => getRupture(req.user.sub, parse(zIdParam, req.params).id))

  app.post('/visits/:id/rupture/confirm', async (req) => {
    const body = parse(z.object({ productIds: z.array(zId).max(500) }), req.body)
    return confirmRupture(req.user.sub, parse(zIdParam, req.params).id, body.productIds)
  })

  app.post('/visits/:id/justify', async (req) => {
    const body = parse(
      z.object({ reasonId: zId, text: z.string().max(2000).optional(), latitude: zLat.optional(), longitude: zLng.optional() }),
      req.body,
    )
    return justify(req.user.sub, parse(zIdParam, req.params).id, body)
  })

  /**
   * Upload de foto (multipart): type, taskId?, notes?, meta? (JSON), productIds? (JSON, fotos de depois),
   * latitude?, longitude?, takenAt? e o arquivo em "file".
   */
  app.post('/visits/:id/photos', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const { fields, file } = await readImageForm(req)
    if (!file) throw badRequest('Envie a foto no campo "file".')

    const input = parse(
      z.object({
        type: z.enum(PhotoType),
        taskId: zId.optional(),
        notes: z.string().max(1000).optional(),
        meta: z.string().max(4000).optional(),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        takenAt: z.iso.datetime({ offset: true }).optional(),
      }),
      fields,
    )
    const meta = jsonField<Record<string, unknown>>(input.meta, 'meta')
    const productIds = fields.productIds ? parse(z.array(zId).max(500), jsonField<unknown>(fields.productIds, 'productIds')) : undefined
    return addPhoto(req.user.sub, id, file, { ...input, meta, productIds, takenAt: input.takenAt ? new Date(input.takenAt) : undefined })
  })

  app.put('/photos/:id/products', async (req) => {
    const body = parse(z.object({ productIds: z.array(zId).max(500) }), req.body)
    return setPhotoProducts(req.user.sub, parse(zIdParam, req.params).id, body.productIds)
  })

  app.delete('/photos/:id', async (req) => {
    await deletePhoto(req.user.sub, parse(zIdParam, req.params).id)
    return { ok: true }
  })

  app.get('/permission-types', async () => listPermissionTypes())

  app.get('/requests', async (req) => {
    const q = parse(z.object({ date: zDate.optional() }), req.query)
    const requests = await prisma.permissionRequest.findMany({
      where: { promotorId: req.user.sub, date: toDbDate(q.date ?? todayIn()) },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    })
    return requests.map(serializeRequest)
  })

  app.post('/requests', async (req) => {
    const body = parse(
      z.object({
        type: z.string().min(1),
        visitId: zId.optional(),
        payload: z.unknown().optional(),
        reason: z.string().trim().min(3, 'explique o motivo do pedido').max(1000),
        latitude: zLat.optional(),
        longitude: zLng.optional(),
      }),
      req.body,
    )
    const created = await createPermissionRequest(req.user, { ...body, promotorId: req.user.sub })
    return serializeRequest(await prisma.permissionRequest.findUniqueOrThrow({ where: { id: created.id }, include: requestInclude }))
  })

  app.post('/requests/:id/cancel', async (req) => {
    await cancelPermissionRequest(req.user.sub, parse(zIdParam, req.params).id)
    return { ok: true }
  })
}
