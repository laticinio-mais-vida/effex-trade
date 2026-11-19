/**
 * Simulador do "dia de hoje" para testar o relatório de tempos ao vivo, SÓ em banco de teste.
 *
 * Pega um dia real do histórico do TradePro (tabela TimeHistory) e o recria como se estivesse acontecendo agora:
 * cria os promotores e os clientes (com CPF/CNPJ) que ainda não existem, apaga o roteiro de hoje de todo mundo e lança
 * o dia no EFFEX: as visitas que já aconteceriam ficam feitas, uma por promotor fica em atendimento e o resto, pendente.
 * Os horários são deslocados para o dia e a hora de hoje, mantendo os tempos reais de cada visita e deslocamento.
 *
 * Uso: npm run simular-dia -- [--base AAAA-MM-DD] [--feito 60] [--aberto-ha MIN] [--limpar]
 *   --base       dia do histórico a copiar (padrão: o dia mais recente com bastante visita)
 *   --feito      percentual do dia já cumprido agora (padrão 60)
 *   --aberto-ha  há quantos minutos o atendimento em aberto começou (padrão: metade do tempo que ele durou de verdade);
 *                use um valor alto (ex.: 120) para ver o alerta "Acontecendo agora"
 *   --limpar     só apaga o roteiro de hoje dos usuários de simulação (login sim.*), sem recriar
 * Os promotores criados têm login sim.<nome> e senha 123456.
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../src/db'
import { env } from '../src/env'
import { toDbDate, todayIn } from '../src/lib/dates'
import { cityKey, nameKey } from '../src/lib/cities'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (process.env.NODE_ENV === 'production' || !/(localhost|127\.0\.0\.1)/.test(env.databaseUrl)) {
  console.error('Este simulador apaga o roteiro de hoje de todos os usuários: só roda em banco local de teste.')
  process.exit(1)
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
const slug = (s: string) => nameKey(s).replace(/ /g, '.')

async function main() {
  const today = todayIn(env.timezone)
  const dayStart = toDbDate(today)

  if (args.includes('--limpar')) {
    const sim = await prisma.user.findMany({ where: { login: { startsWith: 'sim.' } }, select: { id: true } })
    const gone = await prisma.workDay.deleteMany({ where: { date: dayStart, promotorId: { in: sim.map((u) => u.id) } } })
    console.log(`Roteiro de hoje apagado para ${sim.length} usuário(s) de simulação (${gone.count} dia(s)).`)
    return
  }

  const percent = Math.min(95, Math.max(5, Number(flag('--feito') ?? 60))) / 100
  const openAgoMin = flag('--aberto-ha') ? Number(flag('--aberto-ha')) : null

  // Dia base: o informado, ou o mais recente (antes de hoje) com pelo menos 20 visitas
  let base = flag('--base')
  if (!base) {
    const days = await prisma.timeHistory.groupBy({ by: ['date'], where: { clientSeconds: { gt: 0 }, date: { lt: dayStart } }, _count: true, orderBy: { date: 'desc' }, take: 30 })
    base = days.find((d) => d._count >= 20)?.date.toISOString().slice(0, 10)
  }
  if (!base) throw new Error('Não achei nenhum dia com bastante visita no histórico. Importe o histórico antes (npm run importar-historico).')
  const rows = await prisma.timeHistory.findMany({ where: { date: toDbDate(base) }, orderBy: [{ promotorName: 'asc' }, { checkinAt: 'asc' }] })
  if (!rows.length) throw new Error(`Nenhuma linha do histórico em ${base}.`)

  // Roteiro de hoje de todo mundo some (inclusive o do seed): o relatório de hoje mostra só a simulação
  const wiped = await prisma.workDay.deleteMany({ where: { date: dayStart } })
  console.log(`Roteiro de hoje (${today}) apagado: ${wiped.count} dia(s) de promotor.`)

  const supervisor = await prisma.user.findUnique({ where: { login: 'supervisor' }, select: { id: true } })
  const passwordHash = await bcrypt.hash('123456', 10)
  const reasons = new Map((await prisma.justificationReason.findMany()).map((r) => [nameKey(r.label), r.id]))
  const now = new Date()

  const byPromotor = new Map<string, typeof rows>()
  for (const r of rows) byPromotor.set(r.promotorName, [...(byPromotor.get(r.promotorName) ?? []), r])

  let visited = 0
  let open = 0
  let pending = 0
  let justified = 0
  for (const [name, list] of byPromotor) {
    // Promotor: cria (ou reaproveita) e liga o histórico dele a este usuário
    const login = `sim.${slug(name)}`.slice(0, 40)
    const user = await prisma.user.upsert({
      where: { login },
      update: { active: true },
      create: { name: titleCase(name), login, passwordHash, role: 'PROMOTOR', supervisorId: supervisor?.id ?? null },
    })
    await prisma.timeHistory.updateMany({ where: { promotorName: name, promotorId: null }, data: { promotorId: user.id } })

    // Clientes: pelo CPF/CNPJ; os que não existem são criados
    const clientIds = new Map<string, string>()
    for (const r of list) {
      if (clientIds.has(r.clientKey)) continue
      const found = await prisma.client.findFirst({ where: { document: r.clientKey }, select: { id: true } })
      const client =
        found ??
        (await prisma.client.create({ data: { name: r.clientName, city: r.city, cityKey: r.city ? cityKey(r.city) : null, state: 'BA', document: r.clientKey, locationSource: null } }))
      clientIds.set(r.clientKey, client.id)
    }

    const done = list.filter((r) => r.clientSeconds > 0 && r.checkinAt && r.checkoutAt).sort((a, b) => a.checkinAt!.getTime() - b.checkinAt!.getTime())
    const others = list.filter((r) => !done.includes(r))
    const cut = Math.min(done.length - 1, Math.floor(done.length * percent))
    const openRow = done.length ? done[cut]! : null
    // Desloca os horários do dia base para hoje: o atendimento em aberto começou na hora certa (ou há --aberto-ha minutos)
    const shift = openRow ? now.getTime() - (openAgoMin != null ? openAgoMin * 60_000 : openRow.clientSeconds * 500) - openRow.checkinAt!.getTime() : 0
    const at = (d: Date) => new Date(d.getTime() + shift)

    const workDay = await prisma.workDay.create({ data: { promotorId: user.id, date: dayStart, startedAt: done[0] ? at(done[0].checkinAt!) : null } })
    let position = 1
    const make = async (r: (typeof rows)[number], state: 'FEITA' | 'ABERTA' | 'PENDENTE' | 'JUSTIFICADA') => {
      const visit = await prisma.visit.create({
        data: {
          workDayId: workDay.id,
          promotorId: user.id,
          clientId: clientIds.get(r.clientKey)!,
          date: dayStart,
          position: position++,
          status: state === 'FEITA' ? 'CONCLUIDA' : state === 'ABERTA' ? 'EM_ATENDIMENTO' : state === 'JUSTIFICADA' ? 'JUSTIFICADA' : 'PENDENTE',
          checkinAt: state === 'FEITA' || state === 'ABERTA' ? at(r.checkinAt!) : null,
          checkoutAt: state === 'FEITA' ? at(r.checkoutAt!) : null,
          ...(state === 'JUSTIFICADA' ? { justifiedAt: now, justificationText: r.comment, justificationReasonId: r.reason ? (reasons.get(nameKey(r.reason)) ?? null) : null } : {}),
        },
      })
      if (state === 'FEITA' || state === 'ABERTA') {
        await prisma.visitSession.create({ data: { visitId: visit.id, checkinAt: at(r.checkinAt!), checkoutAt: state === 'FEITA' ? at(r.checkoutAt!) : null } })
      }
    }
    for (const [i, r] of done.entries()) {
      if (i < cut) (await make(r, 'FEITA'), visited++)
      else if (i === cut) (await make(r, 'ABERTA'), open++)
      else (await make(r, 'PENDENTE'), pending++)
    }
    for (const r of others) {
      const wasJustified = /justific/i.test(r.status ?? '') || !!r.reason
      await make(r, wasJustified ? 'JUSTIFICADA' : 'PENDENTE')
      wasJustified ? justified++ : pending++
    }
  }

  console.log(`Dia ${base} do histórico recriado como hoje (${today}): ${byPromotor.size} promotores, ${visited} visitas feitas, ${open} em atendimento, ${justified} justificadas, ${pending} pendentes.`)
  console.log('Abra "Tempos de roteiro" no painel (data de hoje). Para refazer com outro cenário, rode de novo; para apagar, use --limpar.')
}

main()
  .catch((e) => {
    console.error(`\nErro: ${e instanceof Error ? e.message : e}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
