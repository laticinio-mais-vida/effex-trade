/**
 * Primeiro acesso num banco novo (ex.: o servidor): cria o administrador e os motivos de justificativa padrão.
 * Com um login que já existe, troca a senha e reativa o usuário (serve para "esqueci a senha do admin").
 * Não apaga nada, ao contrário do seed.
 *
 * Uso: npm run criar-admin -- [login] [--nome "Nome completo"]
 * No servidor: docker exec -it effex_api npm run criar-admin
 */
import bcrypt from 'bcryptjs'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { DEFAULT_REASONS } from '../prisma/reasons'
import { prisma } from '../src/db'

const args = process.argv.slice(2)
const nameFlag = args.indexOf('--nome')
const name = nameFlag >= 0 ? args[nameFlag + 1]?.trim() : undefined
const login = (args.find((a, i) => !a.startsWith('--') && (nameFlag < 0 || i !== nameFlag + 1)) ?? 'admin').trim().toLowerCase()

if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
  console.error('Login inválido: use de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).')
  process.exit(1)
}

/** Lê a senha sem mostrar o que é digitado (o eco do terminal vai para uma saída muda). */
async function askHidden(question: string) {
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() })
  const rl = createInterface({ input: stdin, output: muted, terminal: true })
  stdout.write(question)
  const answer = await rl.question('')
  rl.close()
  stdout.write('\n')
  return answer
}

async function main() {
  if (!stdin.isTTY) throw new Error('Rode num terminal interativo (no servidor: docker exec -it ...), para digitar a senha.')
  const existing = await prisma.user.findUnique({ where: { login } })
  console.log(existing ? `O usuário "${login}" já existe: a senha será trocada e ele ficará ativo.` : `Criando o administrador "${login}".`)

  const password = await askHidden('Senha (mínimo 6 caracteres): ')
  if (password.length < 6) throw new Error('A senha precisa ter ao menos 6 caracteres.')
  if ((await askHidden('Repita a senha: ')) !== password) throw new Error('As senhas não conferem.')
  const passwordHash = await bcrypt.hash(password, 10)

  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, active: true, ...(name ? { name } : {}) } })
    console.log(`Senha de "${login}" trocada.`)
  } else {
    await prisma.user.create({ data: { login, name: name || 'Administrador', role: 'ADMIN', passwordHash } })
    console.log(`Administrador "${login}" criado.`)
  }

  if ((await prisma.justificationReason.count()) === 0) {
    await prisma.justificationReason.createMany({ data: DEFAULT_REASONS.map((label, position) => ({ label, position })) })
    console.log(`${DEFAULT_REASONS.length} motivos de justificativa padrão criados.`)
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
