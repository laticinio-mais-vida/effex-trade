import fjwt from '@fastify/jwt'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma, type Role } from './db'
import { env } from './env'
import { forbidden, unauthorized } from './lib/errors'

export type AuthUser = { sub: string; role: Role; name: string }

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser
    user: AuthUser
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(fjwt, { secret: env.jwtSecret, sign: { expiresIn: '7d' } })
}

/**
 * preHandler que exige login e (opcionalmente) um dos perfis informados.
 * O perfil é relido do banco a cada requisição, então desativar um usuário ou trocar
 * seu perfil vale imediatamente, mesmo com token ainda válido.
 */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    try {
      await req.jwtVerify()
    } catch {
      throw unauthorized()
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { active: true, role: true, name: true } })
    if (!user || !user.active) throw unauthorized('Usuário inativo ou removido.')
    req.user = { sub: req.user.sub, role: user.role, name: user.name }
    if (roles.length > 0 && !roles.includes(user.role)) throw forbidden()
  }
}
