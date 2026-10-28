import 'dotenv/config'
import { resolve } from 'node:path'

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`)
  return value
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? '0.0.0.0',
  uploadDir: resolve(process.env.UPLOAD_DIR ?? './uploads'),
  /** Fuso usado para definir "hoje" (roteiro do dia, relatórios). */
  timezone: process.env.TZ_APP ?? 'America/Bahia',
  /** Servidor OSRM próprio para distâncias pelas ruas (ver infra/osrm). Sem ele, as distâncias ficam em linha reta. */
  osrmUrl: process.env.OSRM_URL?.trim().replace(/\/+$/, '') || null,
}
