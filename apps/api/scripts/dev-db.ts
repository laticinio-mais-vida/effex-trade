/**
 * Sobe um PostgreSQL local para desenvolvimento (binários via npm, sem instalação de administrador).
 *
 * O Postgres no Windows não aceita caminhos com acento (ex.: "Área de Trabalho"), então os binários
 * são copiados uma vez para %LOCALAPPDATA%\effex-trade\pgsql. Os dados também ficam lá, fora do
 * OneDrive, para evitar corrupção pela sincronização.
 *
 * Em produção, aponte DATABASE_URL para um Postgres gerenciado e não use este script.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import os from 'node:os'
import pg from 'pg'

const binaries: { postgres: string } = await import(`@embedded-postgres/${os.platform() === 'win32' ? 'windows' : os.platform()}-${os.arch()}`)
const pkgDir = dirname(dirname(dirname(binaries.postgres)))
const pkgVersion: string = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version

const baseDir = join(process.env.LOCALAPPDATA ?? join(os.homedir(), '.local', 'share'), 'effex-trade')
const binRoot = join(baseDir, `pgsql-${pkgVersion}`)
const dataDir = process.env.PG_DATA_DIR ?? join(baseDir, 'pgdata')
const port = Number(process.env.PG_PORT ?? 5433)
const exe = (name: string) => join(binRoot, 'bin', os.platform() === 'win32' ? `${name}.exe` : name)

if (!existsSync(exe('postgres'))) {
  console.log(`[db] copiando binários do PostgreSQL para ${binRoot}`)
  mkdirSync(baseDir, { recursive: true })
  cpSync(join(pkgDir, 'native'), binRoot, { recursive: true })
}

const fresh = !existsSync(join(dataDir, 'PG_VERSION'))
if (fresh) {
  console.log(`[db] inicializando cluster em ${dataDir}`)
  const pwFile = join(baseDir, 'pwfile')
  writeFileSync(pwFile, 'postgres\n')
  const r = spawnSync(exe('initdb'), ['-D', dataDir, '-U', 'postgres', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '--encoding=UTF8', '--locale=C'], { stdio: 'inherit' })
  rmSync(pwFile, { force: true })
  if (r.status !== 0) {
    console.error('[db] initdb falhou')
    process.exit(1)
  }
}

const server = spawn(exe('postgres'), ['-D', dataDir, '-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout.on('data', (d) => process.stdout.write(`[pg] ${d}`))
server.stderr.on('data', (d) => process.stdout.write(`[pg] ${d}`))
server.on('exit', (code) => {
  console.log(`[db] postgres encerrou (código ${code})`)
  process.exit(code ?? 0)
})

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    const client = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'postgres' })
    try {
      await client.connect()
      return client
    } catch {
      await client.end().catch(() => {})
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('PostgreSQL não respondeu a tempo')
}

const admin = await waitReady()
const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'effex'`)
if (exists.rowCount === 0) await admin.query('CREATE DATABASE effex')
await admin.end()
console.log(`[db] PostgreSQL pronto em postgresql://postgres:postgres@localhost:${port}/effex  (Ctrl+C para parar)`)

const stop = () => {
  server.kill('SIGINT')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
