import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../../auth'
import { isUniqueViolation, prisma } from '../../db'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { parse, zId, zIdParam, zPage, zQueryBool } from '../../lib/validate'
import { clientMatcher } from '../../services/clients'
import { productRef } from '../../services/serializers'

const productBody = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(120).nullish(),
  category: z.string().trim().max(120).nullish(),
  active: z.boolean().optional(),
})

/**
 * Catálogo de produtos e mix dos clientes (o que cada cliente compra).
 * O mix é a base do contraste de ruptura: produto do mix que não aparece nas fotos de depois.
 */
export async function adminProdutosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('ADMIN', 'SUPERVISOR'))

  app.get('/products', async (req) => {
    const q = parse(z.object({ search: z.string().trim().optional(), active: zQueryBool.optional(), ...zPage }), req.query)
    const where = {
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { code: { contains: q.search } },
              { brand: { contains: q.search, mode: 'insensitive' as const } },
              { category: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, include: { _count: { select: { mixes: true } } }, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: products.map((p) => ({ ...productRef(p), category: p.category, active: p.active, mixClients: p._count.mixes })),
    }
  })

  app.post('/products', async (req) => {
    const body = parse(productBody, req.body)
    try {
      return await prisma.product.create({ data: body })
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um produto com este código.')
      throw e
    }
  })

  app.patch('/products/:id', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(productBody.partial(), req.body)
    try {
      return await prisma.product.update({ where: { id }, data: body })
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um produto com este código.')
      throw e
    }
  })

  /** Importação do catálogo (planilha convertida no painel). Atualiza pelo código. */
  app.post('/products/import', async (req) => {
    const body = parse(z.object({ products: z.array(productBody).min(1).max(5000) }), req.body)
    let created = 0
    let updated = 0
    for (const p of body.products) {
      const existing = await prisma.product.findUnique({ where: { code: p.code }, select: { id: true } })
      if (existing) {
        await prisma.product.update({ where: { id: existing.id }, data: p })
        updated++
      } else {
        await prisma.product.create({ data: p })
        created++
      }
    }
    return { created, updated }
  })

  /**
   * Importa o mix (linhas cliente x produto). O cliente vem pelo id (planilha de clientes baixada do painel) ou
   * pelo nome fantasia com cidade e UF. Para cada cliente presente no arquivo, o mix é substituído pelo do arquivo;
   * clientes fora do arquivo ficam como estão.
   */
  app.post('/mix/import', async (req) => {
    const zText = z.string().trim().max(200).nullish()
    const body = parse(
      z.object({
        rows: z
          .array(z.object({ client: z.object({ id: zText, name: zText, legalName: zText, city: zText, state: zText }), productCode: z.string().trim().min(1) }))
          .min(1)
          .max(100_000),
      }),
      req.body,
    )
    const [matcher, products] = await Promise.all([
      clientMatcher(),
      prisma.product.findMany({ where: { code: { in: [...new Set(body.rows.map((r) => r.productCode))] } }, select: { id: true, code: true } }),
    ])
    const productByCode = new Map(products.map((p) => [p.code, p.id]))
    const unknownClients = new Set<string>()
    const unknownProducts = [...new Set(body.rows.filter((r) => !productByCode.has(r.productCode)).map((r) => r.productCode))]

    const mix = new Map<string, Set<string>>()
    for (const r of body.rows) {
      const ref = { ...r.client, state: r.client.state?.toUpperCase() }
      const found = matcher.match(ref)
      if ('error' in found) {
        const label = ref.id ? `id ${ref.id}` : `${ref.name || ref.legalName || '(sem nome)'} (${[ref.city, ref.state].filter(Boolean).join(' - ') || 'sem cidade'})`
        unknownClients.add(found.error === 'AMBIGUO' ? `${label}: mais de um cliente com este nome, use o id` : label)
        continue
      }
      const productId = productByCode.get(r.productCode)
      if (!productId) continue
      mix.set(found.client.id, (mix.get(found.client.id) ?? new Set()).add(productId))
    }
    await prisma.$transaction(async (tx) => {
      for (const [clientId, productIds] of mix) {
        await tx.clientProduct.deleteMany({ where: { clientId } })
        await tx.clientProduct.createMany({ data: [...productIds].map((productId) => ({ clientId, productId })) })
      }
    })
    return {
      clients: mix.size,
      rows: [...mix.values()].reduce((s, set) => s + set.size, 0),
      unknownClients: [...unknownClients],
      unknownProducts,
    }
  })

  app.get('/clients/:id/mix', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const mix = await prisma.clientProduct.findMany({ where: { clientId: id }, include: { product: true }, orderBy: { product: { name: 'asc' } } })
    return mix.map((m) => ({ ...productRef(m.product), active: m.product.active }))
  })

  app.put('/clients/:id/mix', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(z.object({ productIds: z.array(zId).max(2000) }), req.body)
    const client = await prisma.client.findUnique({ where: { id } })
    if (!client) throw notFound('Cliente')
    const ids = [...new Set(body.productIds)]
    if ((await prisma.product.count({ where: { id: { in: ids } } })) !== ids.length) throw badRequest('Um ou mais produtos não existem.')
    await prisma.$transaction([
      prisma.clientProduct.deleteMany({ where: { clientId: id } }),
      prisma.clientProduct.createMany({ data: ids.map((productId) => ({ clientId: id, productId })) }),
    ])
    return { ok: true, count: ids.length }
  })
}
