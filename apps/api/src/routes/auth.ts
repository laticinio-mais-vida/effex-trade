import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../auth'
import { prisma } from '../db'
import { badRequest, HttpError, unauthorized } from '../lib/errors'
import { parse } from '../lib/validate'
import { serializeUser } from '../services/serializers'

export async function authRoutes(app: FastifyInstance) {
  const loginLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => new HttpError(429, 'Muitas tentativas de login. Aguarde um minuto e tente de novo.', 'MUITAS_TENTATIVAS'),
      },
    },
  }

  app.post('/login', loginLimit, async (req) => {
    const body = parse(z.object({ login: z.string().trim().min(1), password: z.string().min(1) }), req.body)
    const user = await prisma.user.findUnique({ where: { login: body.login.toLowerCase() } })
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw unauthorized('Login ou senha incorretos.')
    if (!user.active) throw unauthorized('Usuário inativo. Fale com o administrador.')
    const token = app.jwt.sign({ sub: user.id, role: user.role, name: user.name })
    return { token, user: serializeUser(user) }
  })

  app.get('/me', { preHandler: requireRole() }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, include: { supervisor: { select: { id: true, name: true } } } })
    return { ...serializeUser(user), supervisor: user.supervisor }
  })

  app.post('/password', { preHandler: requireRole() }, async (req) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(6, 'a nova senha precisa ter ao menos 6 caracteres') }), req.body)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } })
    if (!(await bcrypt.compare(body.current, user.passwordHash))) throw badRequest('Senha atual incorreta.')
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.next, 10) } })
    return { ok: true }
  })
}
