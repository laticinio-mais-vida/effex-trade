import { prisma, type Prisma } from '../db'
import { cityKey, nameKey } from '../lib/cities'
import { conflict, forbidden } from '../lib/errors'
import { inAreas, loadAreas } from './scope'

/** Clientes com latitude e longitude: só eles entram em roteiro e visita. */
export const located = { latitude: { not: null }, longitude: { not: null } } satisfies Prisma.ClientWhereInput
export const unlocated = { OR: [{ latitude: null }, { longitude: null }] } satisfies Prisma.ClientWhereInput

/** Busca por nome fantasia, razão social ou cidade. */
export function clientSearch(search: string): Prisma.ClientWhereInput {
  return {
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { legalName: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
    ],
  }
}

/** Grava a cidade junto com a chave usada para casar o cliente com as cidades dos usuários. */
export function withCityKey<T extends { city?: string | null }>(data: T) {
  return { ...data, ...(data.city !== undefined ? { cityKey: data.city ? cityKey(data.city) : null } : {}) }
}

/** Ponto do cliente para a cerca eletrônica. */
export function clientPoint(client: { name: string; latitude: number | null; longitude: number | null }) {
  if (client.latitude == null || client.longitude == null) {
    throw conflict(`${client.name} está sem localização: cadastre a latitude e a longitude no painel, em Clientes.`, 'CLIENTE_SEM_LOCALIZACAO')
  }
  return { latitude: client.latitude, longitude: client.longitude }
}

type AreaClient = { name: string; state: string | null; cityKey: string | null; city: string | null }

/** Recusa cliente fora das cidades do usuário (admin não tem restrição). `who` entra na mensagem (padrão: o nome do usuário). */
export async function assertClientInArea(user: { id: string; role: string; name?: string }, client: AreaClient, who = user.name) {
  if (user.role === 'ADMIN') return
  if (inAreas(client, await loadAreas(user.id))) return
  const place = [client.city, client.state].filter(Boolean).join(' - ') || 'sem cidade cadastrada'
  throw forbidden(`${client.name} (${place}) fica fora das cidades atendidas por ${who}.`, 'CLIENTE_FORA_DA_AREA')
}

type KeyFields = { id: string; name: string; legalName: string | null; state: string | null; cityKey: string | null }

/** Cliente numa planilha: o id (da planilha baixada do painel) ou o nome com cidade e UF. */
export type ClientRef = { id?: string | null; name?: string | null; legalName?: string | null; city?: string | null; state?: string | null }

export type ClientMatch = { client: KeyFields } | { error: 'NAO_ENCONTRADO' | 'AMBIGUO' | 'INCOMPLETO' }

/**
 * Localiza os clientes das planilhas de importação: pelo id, quando a linha tem; senão pela cidade e UF com o
 * nome fantasia (ou a razão social), sem diferença de acento e maiúsculas. Com dois clientes de mesmo nome
 * fantasia na cidade, a razão social desempata.
 */
export async function clientMatcher() {
  const byId = new Map<string, KeyFields>()
  const byPlace = new Map<string, KeyFields[]>()
  const place = (state: string | null, key: string | null) => `${state}|${key}`
  const add = (c: KeyFields) => {
    byId.set(c.id, c)
    const k = place(c.state, c.cityKey)
    byPlace.set(k, [...(byPlace.get(k) ?? []).filter((x) => x.id !== c.id), c])
  }
  for (const c of await prisma.client.findMany({ select: { id: true, name: true, legalName: true, state: true, cityKey: true } })) add(c)

  const sameName = (name: string | null, key: string) => !!name && nameKey(name) === key
  const match = (ref: ClientRef): ClientMatch => {
    if (ref.id) {
      const c = byId.get(ref.id)
      return c ? { client: c } : { error: 'NAO_ENCONTRADO' }
    }
    if (!ref.state || !ref.city || (!ref.name && !ref.legalName)) return { error: 'INCOMPLETO' }
    const candidates = byPlace.get(place(ref.state, cityKey(ref.city))) ?? []
    const legal = ref.legalName ? nameKey(ref.legalName) : null
    let list = ref.name
      ? candidates.filter((c) => sameName(c.name, nameKey(ref.name!)))
      : candidates.filter((c) => sameName(c.legalName, legal!) || sameName(c.name, legal!))
    if (list.length > 1 && ref.name && legal) list = list.filter((c) => sameName(c.legalName, legal))
    if (list.length === 1) return { client: list[0]! }
    return { error: list.length === 0 ? 'NAO_ENCONTRADO' : 'AMBIGUO' }
  }
  // add: registra o cliente criado ou alterado durante a importação, para as linhas seguintes o encontrarem
  return { match, add }
}
