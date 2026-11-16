import type { Prisma } from '../db'

/**
 * Catálogo de produtos e mix dos clientes, vindos do ERP. Roda na transação da sincronização dos clientes, depois de
 * trocar as vendas (src/services/erp-sales.ts), e só quando o pacote traz as vendas: sem elas, ficam o catálogo e o mix
 * do envio anterior.
 * - Catálogo: os produtos que aparecem nas vendas entram pelo código interno do ERP (PRODUTOS.ID_PRODUTO), com o código
 *   (PRODUTOS.CODIGO) e o nome de lá. O cadastrado antes à mão com o mesmo código passa a ser do ERP e mantém as fotos e
 *   as rupturas. A situação (ativo) é do painel: a sincronização não mexe nela, e o produto desativado fica fora do mix
 *   na leitura (services/visits.ts).
 * - Mix: nos clientes do ERP, os produtos das vendas do cliente no período, refeito a cada envio. Os clientes sem código
 *   do ERP ficam com o mix que têm.
 * Nada sai do catálogo: fotos e rupturas antigas continuam apontando para os produtos.
 */

export type ErpProduct = { erpId: number; code: string; name: string }

/** Código provisório, para dois produtos trocarem de código sem bater na unicidade no meio do caminho. */
const tempCode = (id: string) => `~${id}`

async function syncErpProducts(tx: Prisma.TransactionClient, products: ErpProduct[]) {
  // O catálogo é pequeno (dezenas de produtos): inteiro na memória, para conferir os códigos de uma vez
  const all = await tx.product.findMany({ select: { id: true, code: true, name: true, erpId: true } })
  type Current = (typeof all)[number]
  const byErp = new Map(all.filter((p) => p.erpId != null).map((p) => [p.erpId!, p]))
  const looseByCode = new Map(all.filter((p) => p.erpId == null).map((p) => [p.code, p]))

  const targets: (ErpProduct & { current: Current | null; link: boolean })[] = []
  for (const p of [...products].sort((a, b) => a.erpId - b.erpId)) {
    const own = byErp.get(p.erpId)
    if (own) {
      targets.push({ ...p, current: own, link: false })
      continue
    }
    // Cadastrado antes à mão com o código do ERP (o CODIGO ou o ID_PRODUTO)
    const loose = looseByCode.get(p.code) ?? looseByCode.get(String(p.erpId))
    if (loose) looseByCode.delete(loose.code)
    targets.push({ ...p, current: loose ?? null, link: !!loose })
  }

  // Código único: o do ERP; repetido (no ERP, ou num produto do catálogo fora destas vendas), com o código interno junto.
  // Quem já tem o código fica com ele, para um produto novo de código repetido não mudar o código de outro
  const mine = new Set(targets.flatMap((t) => (t.current ? [t.current.id] : [])))
  const taken = new Set(all.filter((p) => !mine.has(p.id)).map((p) => p.code))
  const repeated: string[] = []
  const keepsFirst = (t: (typeof targets)[number]) => Number(t.current?.code === t.code)
  for (const t of [...targets].sort((a, b) => keepsFirst(b) - keepsFirst(a) || a.erpId - b.erpId)) {
    let code = t.code
    for (let n = 1; taken.has(code); n++) code = `${t.code}-${t.erpId}${n > 1 ? `-${n}` : ''}`
    if (code !== t.code) repeated.push(code)
    taken.add(code)
    t.code = code
  }

  // Em duas passadas: numa troca de código entre dois produtos, o código novo de um ainda é o atual do outro
  for (const t of targets) {
    if (t.current && t.current.code !== t.code) await tx.product.update({ where: { id: t.current.id }, data: { code: tempCode(t.current.id) } })
  }
  let updated = 0
  for (const t of targets) {
    if (!t.current || (!t.link && t.current.code === t.code && t.current.name === t.name)) continue
    await tx.product.update({ where: { id: t.current.id }, data: { code: t.code, name: t.name, ...(t.link ? { erpId: t.erpId } : {}) } })
    if (!t.link) updated++
  }
  const creates = targets.filter((t) => !t.current)
  if (creates.length) await tx.product.createMany({ data: creates.map((t) => ({ erpId: t.erpId, code: t.code, name: t.name })) })
  return { total: targets.length, created: creates.length, updated, linked: targets.filter((t) => t.link).length, repeated }
}

/** Refaz o mix dos clientes do ERP com as vendas guardadas (já as do pacote). Grava só a diferença. */
async function rebuildErpMix(tx: Prisma.TransactionClient) {
  // Estatísticas em dia antes do contraste: logo depois de uma carga grande (a primeira sincronização, ou um banco
  // restaurado), o Postgres ainda acha que as vendas estão vazias e escolhe um plano que compara cada par do mix com cada
  // item vendido. Medido com o volume real: o envio levou 76 s sem isto e 2 s com isto; o ANALYZE (que vê as linhas
  // desta transação) custa ~0,15 s
  await tx.$executeRaw`ANALYZE "Client", "ErpSale", "ErpSaleItem", "ClientProduct"`
  // Tudo no banco: são dezenas de milhares de pares cliente x produto
  const removed = await tx.$executeRaw`
    DELETE FROM "ClientProduct" cp USING "Client" c
    WHERE cp."clientId" = c."id" AND c."erpId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "ErpSale" s
      JOIN "ErpSaleItem" i ON i."saleId" = s."id"
      JOIN "Product" p ON p."erpId" = i."productErpId"
      WHERE s."clientId" = cp."clientId" AND p."id" = cp."productId")`
  const added = await tx.$executeRaw`
    INSERT INTO "ClientProduct" ("clientId", "productId", "updatedAt")
    SELECT DISTINCT s."clientId", p."id", CURRENT_TIMESTAMP
    FROM "ErpSale" s
    JOIN "ErpSaleItem" i ON i."saleId" = s."id"
    JOIN "Product" p ON p."erpId" = i."productErpId"
    ON CONFLICT ("clientId", "productId") DO NOTHING`
  const [count] = await tx.$queryRaw<{ clients: number; rows: number }[]>`
    SELECT COUNT(DISTINCT cp."clientId")::int AS "clients", COUNT(*)::int AS "rows"
    FROM "ClientProduct" cp JOIN "Client" c ON c."id" = cp."clientId"
    WHERE c."erpId" IS NOT NULL`
  return { clients: count?.clients ?? 0, rows: count?.rows ?? 0, added, removed }
}

/** Catálogo e mix a partir das vendas do pacote (products: os produtos das vendas guardadas). */
export async function syncErpMix(tx: Prisma.TransactionClient, products: ErpProduct[]) {
  const catalog = await syncErpProducts(tx, products)
  return { products: catalog, ...(await rebuildErpMix(tx)) }
}
