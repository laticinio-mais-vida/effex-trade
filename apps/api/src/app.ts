import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { mkdirSync } from 'node:fs'
import { registerAuth } from './auth'
import { env } from './env'
import { HttpError } from './lib/errors'
import { adminCadastrosRoutes } from './routes/admin/cadastros'
import { adminOperacaoRoutes } from './routes/admin/operacao'
import { adminProdutosRoutes } from './routes/admin/produtos'
import { auditRoutes } from './routes/audit'
import { authRoutes } from './routes/auth'
import { promotorRoutes } from './routes/promotor'
import { supervisorRoutes } from './routes/supervisor'
import { syncRoutes } from './routes/sync'
import { trackingRoutes } from './routes/tracking'
import { updatesRoutes } from './routes/updates'

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 20 * 1024 * 1024, trustProxy: env.trustProxy })

  // O padrão do @fastify/cors só libera GET/HEAD/POST; o painel também usa PUT, PATCH e DELETE
  await app.register(cors, { origin: env.corsOrigins ?? true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], exposedHeaders: ['Content-Disposition'] })
  // Limite só onde for configurado na rota (ex.: login), para não atrapalhar o envio de fotos e pings
  await app.register(rateLimit, { global: false })
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } })
  mkdirSync(env.uploadDir, { recursive: true })
  await app.register(fastifyStatic, { root: env.uploadDir, prefix: '/uploads/', decorateReply: false })
  // Bundle e assets das atualizações do app: cada publicação tem pasta própria e nunca muda (com ponto: ainda copiando)
  mkdirSync(env.updatesDir, { recursive: true })
  await app.register(fastifyStatic, { root: env.updatesDir, prefix: '/updates/files/', decorateReply: false, immutable: true, maxAge: '365d', dotfiles: 'ignore' })
  await registerAuth(app)

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details })
    }
    const status = (error as { statusCode?: number }).statusCode
    if (status && status < 500) {
      return reply.status(status).send({ error: (error as Error).message, code: (error as { code?: string }).code })
    }
    req.log.error(error)
    return reply.status(500).send({ error: 'Erro interno no servidor.', code: 'ERRO_INTERNO' })
  })

  app.get('/health', async () => ({ ok: true, time: new Date() }))

  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(promotorRoutes, { prefix: '/promotor' })
  await app.register(trackingRoutes, { prefix: '/tracking' })
  await app.register(auditRoutes, { prefix: '/audit' })
  await app.register(supervisorRoutes, { prefix: '/supervisor' })
  await app.register(adminCadastrosRoutes, { prefix: '/admin' })
  await app.register(adminOperacaoRoutes, { prefix: '/admin' })
  await app.register(adminProdutosRoutes, { prefix: '/admin' })
  await app.register(syncRoutes, { prefix: '/sync' })
  await app.register(updatesRoutes, { prefix: '/updates' })

  return app
}
