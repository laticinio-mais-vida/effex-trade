import type { Prisma } from '../db'
import type { AuthUser } from '../auth'
import { forbidden } from '../lib/errors'

/** Promotores visíveis para o usuário: admin vê todos, supervisor vê a própria equipe. */
export function promotorScope(user: AuthUser): Prisma.UserWhereInput {
  if (user.role === 'ADMIN') return { role: 'PROMOTOR' }
  if (user.role === 'SUPERVISOR') return { role: 'PROMOTOR', supervisorId: user.sub }
  throw forbidden()
}

/**
 * Fotos que o usuário pode auditar:
 * vendedor -> fotos dos seus clientes; supervisor -> fotos dos promotores ou dos clientes dos vendedores da equipe.
 */
export function photoScope(user: AuthUser): Prisma.PhotoWhereInput {
  if (user.role === 'ADMIN') return {}
  if (user.role === 'VENDEDOR') return { visit: { client: { sellerId: user.sub } } }
  if (user.role === 'SUPERVISOR') {
    return { OR: [{ visit: { promotor: { supervisorId: user.sub } } }, { visit: { client: { seller: { supervisorId: user.sub } } } }] }
  }
  throw forbidden()
}

export function assertAdmin(user: AuthUser) {
  if (user.role !== 'ADMIN') throw forbidden('Somente administradores podem alterar este cadastro.')
}
