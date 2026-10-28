import { prisma, type Prisma, type Role } from '../db'
import type { AuthUser } from '../auth'
import { cityKey } from '../lib/cities'
import { forbidden } from '../lib/errors'

export type Area = { state: string; city: string | null }

/** Promotores visíveis para o usuário: admin vê todos, supervisor vê a própria equipe. */
export function promotorScope(user: AuthUser): Prisma.UserWhereInput {
  if (user.role === 'ADMIN') return { role: 'PROMOTOR' }
  if (user.role === 'SUPERVISOR') return { role: 'PROMOTOR', supervisorId: user.sub }
  throw forbidden()
}

export async function loadAreas(userId: string): Promise<Area[]> {
  return prisma.userArea.findMany({ where: { userId }, select: { state: true, city: true }, orderBy: [{ state: 'asc' }, { city: 'asc' }] })
}

/** Clientes das cidades informadas (área sem cidade = a UF inteira). Sem nenhuma área, nenhum cliente. */
export function areaWhere(areas: Area[]): Prisma.ClientWhereInput {
  if (areas.length === 0) return { id: { in: [] } }
  return { OR: areas.map((a) => (a.city ? { state: a.state, cityKey: cityKey(a.city) } : { state: a.state })) }
}

/** O mesmo filtro de areaWhere, para um cliente já carregado. */
export function inAreas(client: { state: string | null; cityKey: string | null }, areas: Area[]) {
  return areas.some((a) => a.state === client.state && (!a.city || cityKey(a.city) === client.cityKey))
}

/**
 * Clientes que aparecem para o usuário: admin vê todos; promotor, vendedor e supervisor
 * só os das cidades (ou UFs) do seu cadastro.
 */
export async function clientScope(user: { sub: string; role: Role }): Promise<Prisma.ClientWhereInput> {
  if (user.role === 'ADMIN') return {}
  return areaWhere(await loadAreas(user.sub))
}

/** Fotos que o usuário pode auditar: as dos clientes das cidades dele (admin vê todas). */
export async function photoScope(user: AuthUser): Promise<Prisma.PhotoWhereInput> {
  if (user.role === 'ADMIN') return {}
  if (user.role === 'VENDEDOR' || user.role === 'SUPERVISOR') return { visit: { client: await clientScope(user) } }
  throw forbidden()
}

export function assertAdmin(user: AuthUser) {
  if (user.role !== 'ADMIN') throw forbidden('Somente administradores podem alterar este cadastro.')
}
