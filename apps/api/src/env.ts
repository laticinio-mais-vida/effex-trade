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
  /** Atualizações do app publicadas por deploy/atualizar-app.ps1 (routes/updates.ts). */
  updatesDir: resolve(process.env.UPDATES_DIR ?? './updates'),
  /** Fuso usado para definir "hoje" (roteiro do dia, relatórios). */
  timezone: process.env.TZ_APP ?? 'America/Bahia',
  /** Servidor OSRM próprio para distâncias pelas ruas (ver infra/osrm). Sem ele, as distâncias ficam em linha reta. */
  osrmUrl: process.env.OSRM_URL?.trim().replace(/\/+$/, '') || null,
  /** Chave da sincronização com o ERP (a mesma do sync/config.ini no computador da empresa). Vazia: /sync desligado. */
  syncKey: process.env.SYNC_KEY?.trim() || null,
  /** Origens liberadas no CORS, separadas por vírgula (ex.: https://effextrade.maisvida.cloud). Vazio: qualquer origem. */
  corsOrigins: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) || null,
  /** true atrás de proxy (Caddy): o IP de quem acessa vem do X-Forwarded-For, para o limite de tentativas de login. */
  trustProxy: process.env.TRUST_PROXY === 'true',
}
