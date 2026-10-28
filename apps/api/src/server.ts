import { buildApp } from './app'
import { prisma } from './db'
import { env } from './env'
import { todayIn } from './lib/dates'
import { checkLunchAlerts } from './services/alerts'
import { ensureWorkDaysForAll } from './services/workdays'

const app = await buildApp()

/** Congela o roteiro do dia de todos os promotores (para que "não feito" apareça mesmo se o promotor não abrir o app). */
async function generateToday() {
  try {
    await ensureWorkDaysForAll(todayIn())
  } catch (error) {
    app.log.error(error, 'falha ao gerar jornadas do dia')
  }
}
await generateToday()
const timer = setInterval(generateToday, 15 * 60_000)
// Alertas ao supervisor (almoço acima do limite) são conferidos a cada minuto
const alertTimer = setInterval(() => checkLunchAlerts().catch((error) => app.log.error(error, 'falha ao conferir alertas')), 60_000)

await app.listen({ port: env.port, host: env.host })

const shutdown = async () => {
  clearInterval(timer)
  clearInterval(alertTimer)
  await app.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
