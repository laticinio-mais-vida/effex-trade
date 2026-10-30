import { prisma, type LocationSource, type Prisma } from '../db'
import { cityKey, UFS } from '../lib/cities'
import { badRequest, conflict } from '../lib/errors'
import { clientMatcher, erpOwnsLocation, samePoint, unlocated } from './clients'

/**
 * Sincronização dos clientes com o ERP. O computador da empresa lê a tabela CLIENTES da cópia do banco (pasta sync/)
 * e manda a lista inteira; aqui ela vira o cadastro de clientes:
 * - cliente com o mesmo código do ERP: atualiza só o que mudou (nome fantasia, razão social, cidade, UF e situação);
 * - cliente novo no ERP: vincula ao cadastro sem código de mesmo nome na cidade e UF (cadastrado antes à mão) ou cria;
 * - código que sumiu do ERP: o cliente fica inativo.
 * Localização: a do ERP entra e é atualizada enquanto ninguém a editar no painel (ou pela planilha); depois disso a
 * editada vale e a sincronização não a muda mais. Coordenada vazia no ERP não apaga a que o cliente já tem.
 * Mix, roteiros e visitas nunca são tocados.
 */

export type ErpClientInput = {
  erpId: number
  name?: string | null
  legalName?: string | null
  city?: string | null
  state?: string | null
  active: boolean
  latitude?: number | null
  longitude?: number | null
}

/** Acima desta fração dos clientes ativos do ERP ficando inativos de uma vez, pede confirmação (cópia do banco incompleta?). */
const MAX_INACTIVATED_SHARE = 0.3
/** A trava acima só vale a partir deste número de clientes ativos do ERP. */
const MIN_FOR_GUARD = 50
const CREATE_BATCH = 1000

let running = false

const clean = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null

type Row = {
  erpId: number
  name: string
  legalName: string | null
  city: string | null
  cityKey: string | null
  state: string | null
  active: boolean
  latitude: number | null
  longitude: number | null
}
type Current = {
  id: string
  erpId: number | null
  name: string
  legalName: string | null
  city: string | null
  state: string | null
  active: boolean
  latitude: number | null
  longitude: number | null
  locationSource: LocationSource | null
}

/** Coordenada utilizável: as duas, dentro dos limites e fora do (0, 0) que alguns cadastros gravam no lugar de vazio. */
function point(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return { latitude: lat, longitude: lng }
}

const codes = (list: number[]) => `${list.slice(0, 10).join(', ')}${list.length > 10 ? '…' : ''}`

function normalize(clients: ErpClientInput[]) {
  const seen = new Set<number>()
  const invalidUf: number[] = []
  const invalidPoint: number[] = []
  const rows = clients.map((c): Row => {
    if (seen.has(c.erpId)) throw badRequest(`O código ${c.erpId} aparece duas vezes no envio.`, 'CODIGO_REPETIDO')
    seen.add(c.erpId)
    const legalName = clean(c.legalName, 200)
    const city = clean(c.city, 120)
    let state = clean(c.state, 20)?.toUpperCase() ?? null
    if (state && !(UFS as readonly string[]).includes(state)) {
      invalidUf.push(c.erpId)
      state = null
    }
    const p = point(c.latitude, c.longitude)
    if (!p && (c.latitude != null || c.longitude != null)) invalidPoint.push(c.erpId)
    return {
      erpId: c.erpId,
      name: clean(c.name, 200) ?? legalName ?? `Cliente ${c.erpId}`,
      legalName,
      city,
      cityKey: city ? cityKey(city) : null,
      state,
      active: c.active,
      latitude: p?.latitude ?? null,
      longitude: p?.longitude ?? null,
    }
  })
  const warnings = [
    ...(invalidUf.length ? [`${invalidUf.length} cliente(s) com UF inválida no ERP ficaram sem UF (códigos ${codes(invalidUf)})`] : []),
    ...(invalidPoint.length ? [`${invalidPoint.length} cliente(s) com latitude/longitude inválida no ERP foram ignorados na localização (códigos ${codes(invalidPoint)})`] : []),
  ]
  return { rows, seen, warnings }
}

const fields = (r: Row) => ({ name: r.name, legalName: r.legalName, city: r.city, cityKey: r.cityKey, state: r.state, active: r.active })

/** O que mudou no ERP desde a última sincronização, fora a localização (null: nada). */
function diff(c: Current, r: Row): Prisma.ClientUpdateInput | null {
  const data: Prisma.ClientUpdateInput = {}
  if (c.name !== r.name) data.name = r.name
  if (c.legalName !== r.legalName) data.legalName = r.legalName
  if (c.city !== r.city) Object.assign(data, { city: r.city, cityKey: r.cityKey })
  if (c.state !== r.state) data.state = r.state
  if (c.active !== r.active) data.active = r.active
  return Object.keys(data).length ? data : null
}

/** Localização do ERP para o cliente, se a dele ainda não é do painel (null: nada a mudar). */
function erpLocation(c: Pick<Current, 'latitude' | 'longitude' | 'locationSource'>, r: Row) {
  if (r.latitude == null || r.longitude == null || !erpOwnsLocation(c)) return null
  if (c.locationSource === 'ERP' && samePoint(c, r)) return null
  return { latitude: r.latitude, longitude: r.longitude, locationSource: 'ERP' as const }
}

export async function syncErpClients(
  input: { clients: ErpClientInput[]; sourceModifiedAt?: Date | null; force?: boolean },
  meta: { sentAt: Date; ip?: string },
) {
  if (running) throw conflict('Já existe uma sincronização em andamento. Tente de novo em instantes.', 'SINCRONIZACAO_EM_ANDAMENTO')
  running = true
  try {
    return await run(input, meta)
  } finally {
    running = false
  }
}

async function run(input: { clients: ErpClientInput[]; sourceModifiedAt?: Date | null; force?: boolean }, meta: { sentAt: Date; ip?: string }) {
  const last = await prisma.erpSync.findFirst({ where: { kind: 'CLIENTES' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
  if (last && meta.sentAt <= last.sentAt) {
    throw conflict('Este envio é igual ou mais antigo que o último recebido. Rode a sincronização de novo.', 'ENVIO_REPETIDO')
  }

  const { rows, seen, warnings } = normalize(input.clients)
  const select = { id: true, erpId: true, name: true, legalName: true, city: true, state: true, active: true, latitude: true, longitude: true, locationSource: true }
  const [existing, unlinked] = await Promise.all([
    prisma.client.findMany({ where: { erpId: { not: null } }, select }),
    prisma.client.findMany({ where: { erpId: null }, select: { id: true, latitude: true, longitude: true, locationSource: true } }),
  ])
  const byErp = new Map(existing.map((c) => [c.erpId!, c]))
  const unlinkedById = new Map(unlinked.map((c) => [c.id, c]))
  const matcher = await clientMatcher({ erpId: null })
  const taken = new Set<string>()

  const updates: { id: string; data: Prisma.ClientUpdateInput }[] = []
  const creates: Prisma.ClientCreateManyInput[] = []
  let updated = 0
  let linked = 0
  let reactivated = 0
  let inactivated = 0
  let located = 0
  let keptManual = 0
  // Ativos primeiro: com dois códigos de mesmo nome na cidade, o cadastro que já existia fica com o ativo
  for (const row of [...rows].sort((a, b) => Number(b.active) - Number(a.active))) {
    const current = byErp.get(row.erpId)
    if (current) {
      const data = diff(current, row)
      const location = erpLocation(current, row)
      if (data) {
        updated++
        if (current.active !== row.active) row.active ? reactivated++ : inactivated++
      }
      if (location) located++
      else if (row.latitude != null && current.locationSource === 'PAINEL' && !samePoint(current, row)) keptManual++
      if (data || location) updates.push({ id: current.id, data: { ...data, ...location } })
      continue
    }
    const found = matcher.match({ name: row.name, legalName: row.legalName, city: row.city, state: row.state })
    if ('client' in found && !taken.has(found.client.id)) {
      taken.add(found.client.id)
      // Cadastrado antes no painel: a localização que ele já tem é do painel; sem ela, vale a do ERP
      const c = unlinkedById.get(found.client.id)!
      const location = c.latitude != null ? (c.locationSource ? {} : { locationSource: 'PAINEL' as const }) : (erpLocation(c, row) ?? {})
      if ('latitude' in location) located++
      updates.push({ id: found.client.id, data: { erpId: row.erpId, ...fields(row), ...location } })
      linked++
      continue
    }
    const location = row.latitude != null ? { latitude: row.latitude, longitude: row.longitude, locationSource: 'ERP' as const } : {}
    if (row.latitude != null) located++
    creates.push({ erpId: row.erpId, ...fields(row), ...location })
  }

  const absent = existing.filter((c) => c.active && !seen.has(c.erpId!))
  const activeBefore = existing.filter((c) => c.active).length
  const goingInactive = inactivated + absent.length
  if (!input.force && activeBefore >= MIN_FOR_GUARD && goingInactive > activeBefore * MAX_INACTIVATED_SHARE) {
    throw conflict(
      `${goingInactive} dos ${activeBefore} clientes ativos do ERP ficariam inativos de uma vez. Confira se a cópia do banco está completa; se estiver certo, rode a sincronização com --forcar.`,
      'MUITOS_INATIVADOS',
      { inactivated: goingInactive, active: activeBefore },
    )
  }

  const unlocatedCount = await prisma.$transaction(
    async (tx) => {
      for (const u of updates) await tx.client.update({ where: { id: u.id }, data: u.data })
      for (let i = 0; i < creates.length; i += CREATE_BATCH) await tx.client.createMany({ data: creates.slice(i, i + CREATE_BATCH) })
      if (absent.length) await tx.client.updateMany({ where: { id: { in: absent.map((c) => c.id) } }, data: { active: false } })
      const count = await tx.client.count({ where: { AND: [{ erpId: { not: null }, active: true }, unlocated] } })
      await tx.erpSync.create({
        data: {
          sentAt: meta.sentAt,
          sourceModifiedAt: input.sourceModifiedAt ?? null,
          total: rows.length,
          created: creates.length,
          updated,
          inactivated: goingInactive,
          reactivated,
          linked,
          located,
          unlocated: count,
          ip: meta.ip ?? null,
        },
      })
      return count
    },
    { maxWait: 10_000, timeout: 120_000 },
  )

  return {
    total: rows.length,
    created: creates.length,
    updated,
    inactivated: goingInactive,
    reactivated,
    linked,
    /** Receberam a localização do ERP (novos ou atualizados) */
    located,
    /** A localização do ERP mudou, mas a editada no painel foi mantida */
    keptManual,
    unchanged: rows.length - creates.length - linked - updates.filter((u) => !('erpId' in u.data)).length,
    unlocated: unlocatedCount,
    warnings,
  }
}
