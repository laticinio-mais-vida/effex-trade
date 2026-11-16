import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../../auth'
import { isUniqueViolation, prisma } from '../../db'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { parse, zId, zIdParam, zPage, zQueryBool } from '../../lib/validate'
import { productRef } from '../../services/serializers'

const productBody = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(120).nullish(),
  category: z.string().trim().max(120).nullish(),
  active: z.boolean().optional(),
})

/** Os produtos já vêm do ERP (houve sincronização com as vendas): o cadastro manual fica fechado. */
async function productsFromErp() {
  return !!(await prisma.product.findFirst({ where: { erpId: { not: null } }, select: { id: true } }))
}

async function assertManualCatalog() {
  if (await productsFromErp()) {
    throw conflict('Os produtos vêm do ERP, com as vendas da sincronização dos clientes: cadastre o produto no ERP.', 'PRODUTO_PELO_ERP')
  }
}

/**
 * Catálogo de produtos e mix dos clientes (o que cada cliente compra). O mix é a base do contraste de ruptura: produto
 * do mix que não aparece nas fotos de depois. Os dois vêm do ERP, com as vendas dos últimos 2 meses que chegam na
 * sincronização dos clientes (services/erp-mix.ts). Aqui se desativa o produto que não deve entrar no contraste; o
 * cadastro manual vale só antes da primeira sincronização com as vendas (e o mix manual, só nos clientes fora do ERP).
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
              { code: { contains: q.search, mode: 'insensitive' as const } },
              { brand: { contains: q.search, mode: 'insensitive' as const } },
              { category: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    const [total, products, erpActive] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, include: { _count: { select: { mixes: true } } }, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      productsFromErp(),
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      /** Os produtos vêm do ERP: o cadastro e a importação manuais ficam fechados */
      erpActive,
      items: products.map((p) => ({ ...productRef(p), category: p.category, active: p.active, erpId: p.erpId, mixClients: p._count.mixes })),
    }
  })

  app.post('/products', async (req) => {
    await assertManualCatalog()
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
    const product = await prisma.product.findUnique({ where: { id } })
    if (!product) throw notFound('Produto')
    // Produto do ERP: código e nome vêm de lá; aqui mudam só marca, categoria e situação (mandar o valor atual não conta)
    const { code, name, ...rest } = body
    if (product.erpId != null) {
      const changed = [code !== undefined && code !== product.code ? 'code' : null, name !== undefined && name !== product.name ? 'name' : null].filter(Boolean)
      if (changed.length) {
        throw conflict(`Código e nome deste produto vêm do ERP (código interno ${product.erpId}). Altere no ERP e rode a sincronização.`, 'CAMPO_DO_ERP', {
          fields: changed,
        })
      }
    }
    try {
      return await prisma.product.update({ where: { id }, data: product.erpId != null ? rest : body })
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Já existe um produto com este código.')
      throw e
    }
  })

  /** Importação do catálogo (planilha convertida no painel), antes de os produtos virem do ERP. Atualiza pelo código. */
  app.post('/products/import', async (req) => {
    await assertManualCatalog()
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

  app.get('/clients/:id/mix', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const mix = await prisma.clientProduct.findMany({ where: { clientId: id }, include: { product: true }, orderBy: { product: { name: 'asc' } } })
    return mix.map((m) => ({ ...productRef(m.product), active: m.product.active }))
  })

  /** Mix editado à mão: só nos clientes fora do ERP (nos do ERP, a sincronização refaz o mix com as vendas). */
  app.put('/clients/:id/mix', async (req) => {
    const { id } = parse(zIdParam, req.params)
    const body = parse(z.object({ productIds: z.array(zId).max(2000) }), req.body)
    const client = await prisma.client.findUnique({ where: { id } })
    if (!client) throw notFound('Cliente')
    if (client.erpId != null) {
      throw conflict(`O mix deste cliente vem das vendas do ERP (código ${client.erpId}): muda a cada sincronização.`, 'MIX_PELO_ERP')
    }
    const ids = [...new Set(body.productIds)]
    if ((await prisma.product.count({ where: { id: { in: ids } } })) !== ids.length) throw badRequest('Um ou mais produtos não existem.')
    await prisma.$transaction([
      prisma.clientProduct.deleteMany({ where: { clientId: id } }),
      prisma.clientProduct.createMany({ data: ids.map((productId) => ({ clientId: id, productId })) }),
    ])
    return { ok: true, count: ids.length }
  })
}
