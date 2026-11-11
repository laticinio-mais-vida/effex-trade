import { prisma, type Prisma } from '../db'
import { fromDbDate, toDbDate } from '../lib/dates'
import { badRequest } from '../lib/errors'

/**
 * Vendas de cada cliente, vindas do ERP. O computador da empresa manda, no mesmo pacote dos clientes (pasta sync/), as
 * notas de venda a cliente não canceladas de 2 meses até o último dia com venda na cópia do banco, com os produtos de
 * cada uma. A cada envio as vendas guardadas são trocadas pelas do pacote: é uma cópia só leitura do ERP. Pacote sem
 * as vendas (a leitura delas falhou no computador, ou a sincronização é da versão anterior) mantém as do envio anterior.
 * Os produtos ficam com o código, o nome e a unidade do ERP, sem ligação com o catálogo de produtos e o mix.
 */

export type ErpSalesInput = {
  /** Primeiro e último dia do período (AAAA-MM-DD) */
  from: string
  to: string
  /** Produtos que aparecem nas vendas (cadastro PRODUTOS do ERP) */
  products: { erpId: number; name?: string | null; unit?: string | null }[]
  list: {
    /** VENDAS.ID_VENDA */
    erpId: number
    clientErpId: number
    date: string
    invoice?: string | null
    items: { product: number; quantity: number; value: number }[]
  }[]
}

/** O computador manda 2 meses: um período bem maior que isso é erro no envio. */
const MAX_PERIOD_DAYS = 400
/** Linhas por INSERT (cada coluna vai num array: um parâmetro por coluna, qualquer que seja o lote). */
const BATCH = 10_000

const clean = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits
/** AAAA-MM-DD que existe no calendário (31/02 não). */
const realDate = (date: string) => {
  const d = toDbDate(date)
  return !Number.isNaN(d.getTime()) && fromDbDate(d) === date
}

type SaleRow = { id: number; clientErpId: number; date: string; invoice: string | null; total: number }
type ItemRow = { saleId: number; productErpId: number; productName: string; unit: string | null; quantity: number; value: number }
export type NormalizedSales = { from: string; to: string; sales: SaleRow[]; items: ItemRow[] }

/** Confere o pacote e monta as linhas, sem gravar. O mesmo produto duas vezes numa nota vira uma linha, somada. */
export function normalizeSales(input: ErpSalesInput): NormalizedSales {
  const { from, to } = input
  if (!realDate(from) || !realDate(to) || from > to) throw badRequest(`Período das vendas inválido (${from} a ${to}).`, 'PERIODO_INVALIDO')
  if (toDbDate(to).getTime() - toDbDate(from).getTime() > MAX_PERIOD_DAYS * 86_400_000) {
    throw badRequest(`O período das vendas passa de ${MAX_PERIOD_DAYS} dias (${from} a ${to}).`, 'PERIODO_INVALIDO')
  }
  const products = new Map(input.products.map((p) => [p.erpId, { name: clean(p.name, 200), unit: clean(p.unit, 20) }]))
  const seen = new Set<number>()
  const sales: SaleRow[] = []
  const items: ItemRow[] = []
  for (const s of input.list) {
    if (seen.has(s.erpId)) throw badRequest(`A venda ${s.erpId} aparece duas vezes no envio.`, 'VENDA_REPETIDA')
    seen.add(s.erpId)
    if (!realDate(s.date) || s.date < from || s.date > to) {
      throw badRequest(`A venda ${s.erpId} tem a data ${s.date}, fora do período das vendas (${from} a ${to}).`, 'VENDA_FORA_DO_PERIODO')
    }
    const byProduct = new Map<number, ItemRow>()
    for (const i of s.items) {
      const row = byProduct.get(i.product)
      if (row) {
        row.quantity += i.quantity
        row.value += i.value
        continue
      }
      const p = products.get(i.product)
      byProduct.set(i.product, {
        saleId: s.erpId,
        productErpId: i.product,
        productName: p?.name ?? `Produto ${i.product}`,
        unit: p?.unit ?? null,
        quantity: i.quantity,
        value: i.value,
      })
    }
    let total = 0
    for (const row of byProduct.values()) {
      row.quantity = round(row.quantity, 3)
      row.value = round(row.value, 2)
      total += row.value
      items.push(row)
    }
    sales.push({ id: s.erpId, clientErpId: s.clientErpId, date: s.date, invoice: clean(s.invoice, 40), total: round(total, 2) })
  }
  return { from, to, sales, items }
}

/**
 * Troca as vendas guardadas pelas do pacote. Roda na transação da sincronização, depois dos clientes (os novos já
 * existem). Venda de um código que não está no cadastro de clientes fica de fora.
 */
export async function replaceSales(tx: Prisma.TransactionClient, input: NormalizedSales) {
  const codes = [...new Set(input.sales.map((s) => s.clientErpId))]
  const clients = await tx.client.findMany({ where: { erpId: { in: codes } }, select: { id: true, erpId: true } })
  const clientByErp = new Map(clients.map((c) => [c.erpId!, c.id]))
  const unknownClients = new Set<number>()
  const kept = new Set<number>()
  const sales: (Omit<SaleRow, 'clientErpId'> & { clientId: string })[] = []
  for (const s of input.sales) {
    const clientId = clientByErp.get(s.clientErpId)
    if (!clientId) {
      unknownClients.add(s.clientErpId)
      continue
    }
    kept.add(s.id)
    sales.push({ id: s.id, clientId, date: s.date, invoice: s.invoice, total: s.total })
  }
  const items = input.items.filter((i) => kept.has(i.saleId))

  await tx.erpSaleItem.deleteMany({})
  await tx.erpSale.deleteMany({})
  // INSERT com unnest, e não createMany: medido no Prisma 7, 60 mil linhas em createMany de 4.000 deixaram ~190 MB presos
  // no heap mesmo depois da transação, e a API do VPS (heap de 320 MB) caía. Assim, ~20 MB e 6 vezes mais rápido.
  // A data vai em texto (AAAA-MM-DD) para o fuso do servidor não mudar o dia
  for (let i = 0; i < sales.length; i += BATCH) {
    const b = sales.slice(i, i + BATCH)
    await tx.$executeRaw`
      INSERT INTO "ErpSale" ("id", "clientId", "date", "invoice", "total")
      SELECT * FROM unnest(${b.map((s) => s.id)}::int[], ${b.map((s) => s.clientId)}::text[], ${b.map((s) => s.date)}::date[],
        ${b.map((s) => s.invoice)}::text[], ${b.map((s) => s.total)}::float8[])`
  }
  for (let i = 0; i < items.length; i += BATCH) {
    const b = items.slice(i, i + BATCH)
    await tx.$executeRaw`
      INSERT INTO "ErpSaleItem" ("saleId", "productErpId", "productName", "unit", "quantity", "value")
      SELECT * FROM unnest(${b.map((r) => r.saleId)}::int[], ${b.map((r) => r.productErpId)}::int[], ${b.map((r) => r.productName)}::text[],
        ${b.map((r) => r.unit)}::text[], ${b.map((r) => r.quantity)}::float8[], ${b.map((r) => r.value)}::float8[])`
  }

  return {
    from: input.from,
    to: input.to,
    /** Vendas guardadas */
    total: sales.length,
    /** Clientes com alguma venda no período */
    clients: new Set(sales.map((s) => s.clientId)).size,
    items: items.length,
    /** Vendas de clientes fora do cadastro, que ficaram de fora */
    skipped: input.sales.length - sales.length,
    unknownClients: [...unknownClients],
  }
}

/** Período das vendas guardadas: o do último envio que trouxe as vendas (null: nenhum trouxe ainda). */
export async function salesPeriod() {
  const last = await prisma.erpSync.findFirst({
    where: { kind: 'CLIENTES', sales: { not: null } },
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true, sales: true, salesFrom: true, salesTo: true },
  })
  if (!last?.salesFrom || !last.salesTo) return null
  return { at: last.receivedAt, from: fromDbDate(last.salesFrom), to: fromDbDate(last.salesTo), total: last.sales ?? 0 }
}

/** As vendas do cliente no período guardado: o resumo por produto (do maior valor para o menor) e as notas, da mais recente. */
export async function clientSales(clientId: string) {
  const [period, sales] = await Promise.all([
    salesPeriod(),
    prisma.erpSale.findMany({
      where: { clientId },
      include: { items: { orderBy: { productName: 'asc' } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
  ])
  type ProductSummary = { erpId: number; name: string; unit: string | null; quantity: number; value: number; purchases: number; lastDate: string }
  const products = new Map<number, ProductSummary>()
  for (const s of sales) {
    for (const i of s.items) {
      const p = products.get(i.productErpId)
      if (p) {
        p.quantity += i.quantity
        p.value += i.value
        p.purchases++
      } else {
        // As notas vêm da mais recente: a primeira em que o produto aparece é a última compra dele
        products.set(i.productErpId, { erpId: i.productErpId, name: i.productName, unit: i.unit, quantity: i.quantity, value: i.value, purchases: 1, lastDate: fromDbDate(s.date) })
      }
    }
  }
  return {
    period,
    count: sales.length,
    total: round(sales.reduce((sum, s) => sum + s.total, 0), 2),
    lastDate: sales[0] ? fromDbDate(sales[0].date) : null,
    products: [...products.values()]
      .map((p) => ({ ...p, quantity: round(p.quantity, 3), value: round(p.value, 2) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    sales: sales.map((s) => ({
      id: s.id,
      date: fromDbDate(s.date),
      invoice: s.invoice,
      total: s.total,
      items: s.items.map((i) => ({ erpId: i.productErpId, name: i.productName, unit: i.unit, quantity: i.quantity, value: i.value })),
    })),
  }
}
