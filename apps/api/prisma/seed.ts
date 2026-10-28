/**
 * Dados de demonstração: usuários, clientes em Salvador-BA, roteiros, 3 dias de histórico
 * (visitas, fotos, rastro de GPS, auditorias) e o dia de hoje em andamento.
 * Apaga tudo antes de inserir. Senha de todos os usuários: 123456
 */
import bcrypt from 'bcryptjs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma, type PhotoType, type Visit } from '../src/db'
import { env } from '../src/env'
import { addDays, localDayRange, toDbDate, todayIn } from '../src/lib/dates'
import { stampPhoto } from '../src/services/photo-stamp'
import { ensureWorkDay } from '../src/services/workdays'
import { mulberry32, shelfPng } from './seed-image'

const rand = mulberry32(42)
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))

async function clear() {
  await prisma.auditReview.deleteMany()
  await prisma.photoAudit.deleteMany()
  await prisma.photo.deleteMany()
  await prisma.permissionRequest.deleteMany()
  await prisma.scheduledVisit.deleteMany()
  await prisma.visit.deleteMany()
  await prisma.workDay.deleteMany()
  await prisma.locationPing.deleteMany()
  await prisma.routeItem.deleteMany()
  await prisma.task.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.justificationReason.deleteMany()
  await prisma.setting.deleteMany()
  await prisma.user.deleteMany()
  await rm(join(env.uploadDir, 'seed'), { recursive: true, force: true })
}

const CLIENTS: [string, string, string, number, number][] = [
  ['1001', 'Supermercado Pituba Center', 'Pituba', -12.9975, -38.4567],
  ['1002', 'Mercado Bom Sabor', 'Itaigara', -12.99, -38.462],
  ['1003', 'Atacarejo Costa Azul', 'Costa Azul', -12.993, -38.444],
  ['1004', 'Mercadinho Boca do Rio', 'Boca do Rio', -12.981, -38.425],
  ['1005', 'Supermercado Imbuí', 'Imbuí', -12.972, -38.435],
  ['1006', 'Empório Pernambués', 'Pernambués', -12.975, -38.46],
  ['1007', 'Supermercado Barra Sul', 'Barra', -13.005, -38.53],
  ['1008', 'Mercado Federação', 'Federação', -13.001, -38.509],
  ['1009', 'Hiper Rio Vermelho', 'Rio Vermelho', -13.011, -38.49],
  ['1010', 'Mercadinho Brotas', 'Brotas', -12.987, -38.495],
  ['1011', 'Supermercado Lapinha', 'Lapinha', -12.96, -38.5],
  ['1012', 'Atacado Calçada', 'Calçada', -12.944, -38.505],
  ['1013', 'Supermercado Itapuã', 'Itapuã', -12.948, -38.365],
  ['1014', 'Mercado Stella Maris', 'Stella Maris', -12.938, -38.336],
  ['1015', 'Hiper Paralela', 'Paralela', -12.937, -38.412],
  ['1016', 'Mercadinho Cabula', 'Cabula', -12.951, -38.46],
  ['1017', 'Supermercado Liberdade', 'Liberdade', -12.948, -38.495],
  ['1018', 'Mercado Ribeira', 'Ribeira', -12.917, -38.504],
]

const REASONS = [
  'Loja fechada',
  'Cliente não autorizou a entrada',
  'Problema com veículo/transporte',
  'Excesso de tempo no cliente anterior',
  'Problema de saúde',
  'Outro',
]

const PRODUCTS: [string, string, string][] = [
  ['P001', 'Iogurte Morango 170g', 'Iogurtes'],
  ['P002', 'Iogurte Pêssego 170g', 'Iogurtes'],
  ['P003', 'Iogurte Natural 170g', 'Iogurtes'],
  ['P004', 'Bebida Láctea Morango 900g', 'Bebidas lácteas'],
  ['P005', 'Bebida Láctea Pêssego 900g', 'Bebidas lácteas'],
  ['P006', 'Leite UHT Integral 1L', 'Leites'],
  ['P007', 'Leite UHT Desnatado 1L', 'Leites'],
  ['P008', 'Requeijão Cremoso 200g', 'Derivados'],
  ['P009', 'Manteiga com Sal 200g', 'Derivados'],
  ['P010', 'Doce de Leite 400g', 'Derivados'],
  ['P011', 'Queijo Mussarela Fatiado 150g', 'Queijos'],
  ['P012', 'Creme de Leite 200g', 'Derivados'],
]

/** Mix de cada cliente (produtos que ele compra), preenchido no main. */
const mixByClient = new Map<string, { id: string; name: string }[]>()

const at = (date: string, minutesFromMidnight: number) => new Date(localDayRange(date).start.getTime() + minutesFromMidnight * 60_000)

async function savePhoto(
  visitId: string,
  type: PhotoType,
  takenAt: Date,
  lat: number,
  lng: number,
  extra: { taskId?: string; notes?: string; meta?: object; productIds?: string[] } = {},
) {
  const { productIds, ...rest } = extra
  const name = `${visitId}-${type}-${Math.floor(rand() * 1e9)}.png`
  const relative = `seed/${name}`
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: { client: true, promotor: { select: { name: true } } } })
  const image = await stampPhoto(shelfPng(Math.floor(rand() * 1e9), type), {
    takenAt,
    type,
    clientName: visit.client.name,
    clientCode: visit.client.code,
    promotorName: visit.promotor.name,
  })
  await mkdir(join(env.uploadDir, 'seed'), { recursive: true })
  await writeFile(join(env.uploadDir, 'seed', name), image)
  return prisma.photo.create({
    data: {
      visitId,
      type,
      path: relative,
      takenAt,
      latitude: lat + (rand() - 0.5) * 0.0004,
      longitude: lng + (rand() - 0.5) * 0.0004,
      ...rest,
      products: productIds ? { create: productIds.map((productId) => ({ productId })) } : undefined,
    },
  })
}

/** Pings a cada 3 min entre dois pontos (deslocamento) ou parado num ponto (atendimento). */
function pingsBetween(promotorId: string, from: Date, to: Date, a: [number, number], b: [number, number]) {
  const out = []
  const total = to.getTime() - from.getTime()
  for (let t = from.getTime(); t <= to.getTime(); t += 3 * 60_000) {
    const k = total > 0 ? (t - from.getTime()) / total : 1
    out.push({
      promotorId,
      latitude: a[0] + (b[0] - a[0]) * k + (rand() - 0.5) * 0.0006,
      longitude: a[1] + (b[1] - a[1]) * k + (rand() - 0.5) * 0.0006,
      accuracy: between(5, 25),
      battery: Math.max(0.15, 0.95 - (t - from.getTime()) / 36e6),
      recordedAt: new Date(t),
    })
  }
  return out
}

type SeedTask = { id: string; clientId: string | null; promotorId: string | null; requiresPhoto: boolean; required: boolean; startDate: Date; endDate: Date | null }

/** done = atendimento completo; forgot = esqueceu o check-out e o sistema encerrou na última foto. */
type Outcome = 'done' | 'justified' | 'pending' | 'forgot'

/**
 * Simula o dia seguindo as regras: o roteiro começa no primeiro check-in; cada atendimento tem
 * fachada, antes, depois com produtos identificados e confirmação de ruptura (mix x fotos de depois).
 */
async function simulateDay(
  promotorId: string,
  date: string,
  outcomes: Record<number, Outcome>,
  reasons: { id: string; label: string }[],
  untilMinute = 24 * 60,
  tasks: SeedTask[] = [],
  startMinute = 8 * 60,
  reopenIndex: number | null = null,
  longLunch = false,
) {
  const workDay = await ensureWorkDay(promotorId, date)
  const visits = await prisma.visit.findMany({ where: { workDayId: workDay.id }, include: { client: true }, orderBy: { position: 'asc' } })
  if (visits.length === 0) return []

  let clock = startMinute + between(-10, 10)
  let lastPoint: [number, number] | null = null
  let started = false
  let allResolved = true
  let lunchDone = false
  let afterLunch = false
  let lastActivity = 0
  const pings = []
  const touched: Visit[] = []

  for (const [i, visit] of visits.entries()) {
    const outcome = outcomes[i] ?? 'done'
    if (outcome === 'pending') {
      allResolved = false
      continue
    }
    const point: [number, number] = [visit.client.latitude, visit.client.longitude]

    // Almoço por volta do meio-dia: sem atividades; a volta é a abertura (ou justificativa) do próximo cliente
    if (started && !lunchDone && clock >= 11 * 60 + 40) {
      const lunchStart = clock + between(2, 6)
      if (lunchStart > untilMinute) break
      await prisma.workDay.update({ where: { id: workDay.id }, data: { lunchStartedAt: at(date, lunchStart), lunchLat: lastPoint?.[0], lunchLng: lastPoint?.[1] } })
      lunchDone = true
      const lunchEnd = lunchStart + (longLunch ? between(130, 150) : between(55, 75))
      if (lastPoint) pings.push(...pingsBetween(promotorId, at(date, lunchStart), at(date, Math.min(lunchEnd, untilMinute)), lastPoint, point))
      if (lunchEnd > untilMinute) {
        clock = untilMinute // ainda está no almoço agora
        break
      }
      clock = lunchEnd
      afterLunch = true
    }

    const travel = lastPoint && !afterLunch ? between(12, 38) : 0
    if (clock + travel > untilMinute) break
    // O app só rastreia depois do primeiro check-in
    if (lastPoint && started) pings.push(...pingsBetween(promotorId, at(date, clock), at(date, clock + travel), lastPoint, point))
    clock += travel

    if (outcome === 'justified') {
      const reason = pick(reasons.slice(0, 3))
      touched.push(
        await prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: 'JUSTIFICADA',
            justificationReasonId: reason.id,
            justificationText:
              reason.label === 'Loja fechada' ? 'Cheguei e a loja estava fechada para balanço, sem previsão de abertura.' : 'Gerente não liberou a entrada hoje, pediu para voltar amanhã.',
            justifiedAt: at(date, clock + 3),
            justifyLat: point[0],
            justifyLng: point[1],
          },
        }),
      )
      if (afterLunch) {
        await prisma.workDay.update({ where: { id: workDay.id }, data: { lunchEndedAt: at(date, clock + 3) } })
        afterLunch = false
      }
      lastActivity = clock + 3
      clock += 5
      lastPoint = point
      continue
    }

    const duration = between(24, 58)
    const checkinAt = at(date, clock)
    const inProgress = clock + duration > untilMinute
    await prisma.visit.update({
      where: { id: visit.id },
      data: {
        status: 'EM_ATENDIMENTO',
        checkinAt,
        checkinLat: point[0] + (rand() - 0.5) * 0.0005,
        checkinLng: point[1] + (rand() - 0.5) * 0.0005,
        checkinAccuracy: between(5, 20),
        checkinDistance: between(8, 70),
      },
    })
    const session = await prisma.visitSession.create({
      data: { visitId: visit.id, checkinAt, checkinLat: point[0], checkinLng: point[1], checkinAccuracy: between(5, 20), checkinDistance: between(8, 70) },
    })
    if (!started) {
      // O roteiro (ponto de início) começa na abertura do primeiro atendimento
      await prisma.workDay.update({ where: { id: workDay.id }, data: { startedAt: checkinAt, startLat: point[0], startLng: point[1] } })
      started = true
    }
    if (afterLunch) {
      await prisma.workDay.update({ where: { id: workDay.id }, data: { lunchEndedAt: checkinAt } })
      afterLunch = false
    }
    lastActivity = clock

    await savePhoto(visit.id, 'FACHADA', checkinAt, point[0], point[1])
    await savePhoto(visit.id, 'ANTES', at(date, clock + 3), point[0], point[1])
    if (inProgress) {
      pings.push(...pingsBetween(promotorId, checkinAt, at(date, untilMinute), point, point))
      clock = untilMinute
      break
    }

    if (rand() < 0.2)
      await savePhoto(visit.id, 'VENCIMENTO', at(date, clock + 10), point[0], point[1], {
        notes: 'Produtos vencendo, retirados da gôndola',
        meta: { produto: pick(PRODUCTS)[1], validade: addDays(date, between(0, 4)), quantidade: between(2, 12) },
      })
    // Atividades extras do dia: as obrigatórias sempre são feitas; as de foto concluem ao fotografar
    const day = toDbDate(date)
    const applicable = tasks.filter(
      (t) => (t.clientId === null || t.clientId === visit.clientId) && (t.promotorId === null || t.promotorId === promotorId) && t.startDate <= day && (t.endDate === null || t.endDate >= day),
    )
    for (const [k, task] of applicable.entries()) {
      if (!task.required && rand() > 0.7) continue
      const when = at(date, clock + 14 + k * 2)
      if (task.requiresPhoto) await savePhoto(visit.id, 'ATIVIDADE_EXTRA', when, point[0], point[1], { taskId: task.id, notes: 'Atividade concluída' })
      await prisma.taskCompletion.create({
        data: { taskId: task.id, visitId: visit.id, completedAt: when, notes: task.requiresPhoto ? null : pick(['Gerente confirmou espaço na ilha a partir do dia 10.', 'Gerente vai avaliar e responde na próxima visita.']) },
      })
    }

    // Fotos de depois com os produtos identificados; o que falta do mix vira ruptura confirmada
    const mix = [...(mixByClient.get(visit.clientId) ?? [])].sort(() => rand() - 0.5)
    const ruptureCount = mix.length > 3 && rand() < 0.45 ? between(1, 2) : 0
    const missing = mix.slice(0, ruptureCount)
    const present = mix.slice(ruptureCount)
    const half = Math.ceil(present.length / 2)
    const groups = present.length > 4 && rand() < 0.6 ? [present.slice(0, half), present.slice(half)] : [present]
    let lastPhotoMinute = clock + duration - 4
    for (const [g, group] of groups.entries()) {
      lastPhotoMinute = clock + duration - 4 - (groups.length - 1 - g) * 3
      await savePhoto(visit.id, 'DEPOIS', at(date, lastPhotoMinute), point[0], point[1], { productIds: group.map((p) => p.id) })
    }
    if (missing.length) await prisma.visitRupture.createMany({ data: missing.map((p) => ({ visitId: visit.id, productId: p.id })) })

    const forgot = outcome === 'forgot'
    await prisma.visitSession.update({
      where: { id: session.id },
      data: forgot
        ? { checkoutAt: at(date, lastPhotoMinute), checkoutLat: point[0], checkoutLng: point[1], autoClosed: true }
        : { checkoutAt: at(date, clock + duration), checkoutLat: point[0], checkoutLng: point[1], checkoutDistance: between(5, 60) },
    })
    await prisma.visit.update({
      where: { id: visit.id },
      data: forgot
        ? // Esqueceu o check-out: o próximo check-in encerrou o atendimento na hora da última foto
          { status: 'CONCLUIDA', autoClosed: true, ruptureConfirmedAt: at(date, lastPhotoMinute + 1), checkoutAt: at(date, lastPhotoMinute), checkoutLat: point[0], checkoutLng: point[1] }
        : {
            status: 'CONCLUIDA',
            ruptureConfirmedAt: at(date, clock + duration - 2),
            checkoutAt: at(date, clock + duration),
            checkoutLat: point[0],
            checkoutLng: point[1],
            checkoutDistance: between(5, 60),
          },
    })
    const end = forgot ? lastPhotoMinute + between(15, 30) : clock + duration
    lastActivity = forgot ? lastPhotoMinute : clock + duration
    pings.push(...pingsBetween(promotorId, checkinAt, at(date, end), point, point))
    clock = end
    lastPoint = point
  }

  if (reopenIndex != null && started && untilMinute >= 24 * 60 && lastPoint) {
    const visit = visits[reopenIndex]!
    const point: [number, number] = [visit.client.latitude, visit.client.longitude]
    const travel = between(10, 25)
    pings.push(...pingsBetween(promotorId, at(date, clock), at(date, clock + travel), lastPoint, point))
    clock += travel
    const checkinAt = at(date, clock)
    await prisma.visitSession.create({
      data: {
        visitId: visit.id,
        checkinAt,
        checkinLat: point[0],
        checkinLng: point[1],
        checkinDistance: between(8, 60),
        checkoutAt: at(date, clock + 18),
        checkoutLat: point[0],
        checkoutLng: point[1],
      },
    })
    await savePhoto(visit.id, 'FACHADA', checkinAt, point[0], point[1])
    await savePhoto(visit.id, 'VENCIMENTO', at(date, clock + 9), point[0], point[1], {
      notes: 'Voltei depois da entrega e retirei os vencidos',
      meta: { produto: pick(PRODUCTS)[1], validade: date, quantidade: between(2, 6) },
    })
    await prisma.visit.update({ where: { id: visit.id }, data: { checkoutAt: at(date, clock + 18), notes: 'Reaberto à tarde após a entrega do caminhão.' } })
    pings.push(...pingsBetween(promotorId, checkinAt, at(date, clock + 18), point, point))
    clock += 18
    lastActivity = clock
    lastPoint = point
  }

  if (started && untilMinute >= 24 * 60) {
    // Ponto de fim = última atividade. Com pendências, o sistema encerrou o roteiro no dia seguinte.
    await prisma.workDay.update({
      where: { id: workDay.id },
      data: {
        endedAt: at(date, lastActivity),
        closedAt: at(date, allResolved ? lastActivity + between(5, 20) : 24 * 60 + 8 * 60),
        endLat: lastPoint?.[0],
        endLng: lastPoint?.[1],
      },
    })
  }
  await prisma.locationPing.createMany({ data: pings })
  return touched
}

async function main() {
  console.log('[seed] limpando dados')
  await clear()

  const passwordHash = await bcrypt.hash('123456', 10)
  const mk = (login: string, name: string, role: 'ADMIN' | 'SUPERVISOR' | 'VENDEDOR' | 'PROMOTOR', supervisorId?: string) =>
    prisma.user.create({ data: { login, name, role, passwordHash, supervisorId, phone: '(71) 9' + between(1000, 9999) + '-' + between(1000, 9999) } })

  const admin = await mk('admin', 'Administrador', 'ADMIN')
  const supervisor = await mk('supervisor', 'Renata Moura', 'SUPERVISOR')
  const vend1 = await mk('vendedor1', 'Carlos Menezes', 'VENDEDOR', supervisor.id)
  const vend2 = await mk('vendedor2', 'Patrícia Lima', 'VENDEDOR', supervisor.id)
  const promotores = [
    await mk('promotor1', 'João Santos', 'PROMOTOR', supervisor.id),
    await mk('promotor2', 'Ana Ribeiro', 'PROMOTOR', supervisor.id),
    await mk('promotor3', 'Lucas Oliveira', 'PROMOTOR', supervisor.id),
  ]

  const clients = []
  for (const [i, [code, name, district, lat, lng]] of CLIENTS.entries()) {
    clients.push(
      await prisma.client.create({
        data: {
          code,
          name,
          address: `Rua Exemplo, ${100 + i * 7} - ${district}`,
          city: 'Salvador',
          state: 'BA',
          latitude: lat,
          longitude: lng,
          sellerId: i < 9 ? vend1.id : vend2.id,
          geofenceRadius: i === 14 ? 300 : null, // Hiper Paralela: estacionamento grande
        },
      }),
    )
  }

  // Catálogo e mix: cada cliente compra de 6 a 9 produtos (no real, virá do ERP/planilha)
  const products = []
  for (const [code, name, category] of PRODUCTS) products.push(await prisma.product.create({ data: { code, name, category } }))
  for (const client of clients) {
    const mix = [...products].sort(() => rand() - 0.5).slice(0, between(6, 9))
    await prisma.clientProduct.createMany({ data: mix.map((p) => ({ clientId: client.id, productId: p.id })) })
    mixByClient.set(client.id, mix)
  }

  const reasons = []
  for (const [i, label] of REASONS.entries()) reasons.push(await prisma.justificationReason.create({ data: { label, position: i } }))

  // Roteiro fixo: cada promotor com 6 clientes de segunda a sexta e 3 no sábado
  for (const [p, promotor] of promotores.entries()) {
    const mine = clients.slice(p * 6, p * 6 + 6)
    for (let weekday = 1; weekday <= 6; weekday++) {
      const list = weekday === 6 ? mine.slice(0, 3) : mine
      await prisma.routeItem.createMany({ data: list.map((c, i) => ({ promotorId: promotor.id, clientId: c.id, weekday, position: i + 1 })) })
    }
  }

  const today = todayIn()
  const tasks = [
    await prisma.task.create({
      data: {
        title: 'Montar ponta de gôndola - Campanha Iogurte Verão',
        description: 'Montar a ponta com 2 frentes de iogurte morango e 2 de pêssego, com o material de PDV da campanha.',
        clientId: clients[1]!.id,
        startDate: toDbDate(addDays(today, -6)),
        endDate: toDbDate(addDays(today, 10)),
        required: true,
        createdById: admin.id,
      },
    }),
    await prisma.task.create({
      data: {
        title: 'Montar ponta de gôndola - Campanha Iogurte Verão',
        description: 'Montar a ponta com 2 frentes de iogurte morango e 2 de pêssego, com o material de PDV da campanha.',
        clientId: clients[7]!.id,
        startDate: toDbDate(addDays(today, -6)),
        endDate: toDbDate(addDays(today, 10)),
        required: true,
        createdById: admin.id,
      },
    }),
    await prisma.task.create({
      data: {
        title: 'Conferir preço do Leite UHT na gôndola',
        description: 'Fotografar a etiqueta de preço do Leite UHT Integral 1L.',
        startDate: toDbDate(addDays(today, -2)),
        endDate: toDbDate(addDays(today, 5)),
        createdById: supervisor.id,
      },
    }),
    await prisma.task.create({
      data: {
        title: 'Perguntar ao gerente sobre espaço na ilha de refrigerados',
        description: 'Sem foto: registre a resposta do gerente na conclusão.',
        promotorId: promotores[0]!.id,
        requiresPhoto: false,
        startDate: toDbDate(addDays(today, -3)),
        endDate: toDbDate(addDays(today, 3)),
        createdById: supervisor.id,
      },
    }),
  ]

  // Histórico: os 3 últimos dias úteis (segunda a sábado) antes de hoje
  const pastDays: string[] = []
  for (let d = 1; pastDays.length < 3; d++) {
    const date = addDays(today, -d)
    if (toDbDate(date).getUTCDay() !== 0) pastDays.unshift(date)
  }
  console.log(`[seed] histórico em ${pastDays.join(', ')} e hoje ${today}`)

  const scenarios: Record<number, Outcome>[][] = [
    [{ 2: 'forgot' }, { 3: 'justified' }, { 5: 'pending' }],
    [{ 4: 'justified' }, {}, { 1: 'forgot', 2: 'justified', 5: 'pending' }],
    [{}, { 1: 'justified', 3: 'forgot' }, { 4: 'pending', 5: 'pending' }],
  ]
  const longLunchDay = pastDays.findIndex((d) => toDbDate(d).getUTCDay() !== 6)
  for (const [d, date] of pastDays.entries()) {
    for (const [p, promotor] of promotores.entries()) {
      // Ana reabre o 2º cliente à tarde no último dia do histórico; Lucas passa de 2h de almoço no primeiro dia
      // que não é sábado (no sábado o roteiro acaba antes do almoço)
      await simulateDay(promotor.id, date, scenarios[d]![p]!, reasons, 24 * 60, tasks, 8 * 60, d === 2 && p === 1 ? 1 : null, d === longLunchDay && p === 2)
    }
  }

  // Alertas de almoço acima de 2h no histórico (já resolvidos e vistos pelo supervisor)
  const longLunches = await prisma.workDay.findMany({ where: { lunchStartedAt: { not: null }, lunchEndedAt: { not: null } }, include: { promotor: true } })
  for (const wd of longLunches) {
    const minutes = (wd.lunchEndedAt!.getTime() - wd.lunchStartedAt!.getTime()) / 60_000
    if (minutes < 120) continue
    const createdAt = new Date(wd.lunchStartedAt!.getTime() + 120 * 60_000)
    const start = wd.lunchStartedAt!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: env.timezone })
    await prisma.alert.create({
      data: {
        type: 'ALMOCO_LONGO',
        promotorId: wd.promotorId,
        workDayId: wd.id,
        message: `${wd.promotor.name} está em almoço desde ${start} e passou de 2h.`,
        createdAt,
        resolvedAt: wd.lunchEndedAt,
        acknowledgedAt: new Date(createdAt.getTime() + 7 * 60_000),
        acknowledgedById: supervisor.id,
      },
    })
  }

  // Liberação aprovada no passado (dispensa de fotos)
  const pastVisit = await prisma.visit.findFirst({ where: { promotorId: promotores[0]!.id, date: toDbDate(pastDays[2]!), status: 'CONCLUIDA' }, orderBy: { position: 'desc' } })
  if (pastVisit) {
    await prisma.visit.update({ where: { id: pastVisit.id }, data: { photosWaived: true } })
    await prisma.permissionRequest.create({
      data: {
        type: 'DISPENSA_FOTOS',
        status: 'APROVADA',
        date: pastVisit.date,
        promotorId: promotores[0]!.id,
        visitId: pastVisit.id,
        reason: 'Celular descarregou no meio do atendimento.',
        createdById: promotores[0]!.id,
        createdAt: pastVisit.checkinAt ?? undefined,
        decidedById: supervisor.id,
        decidedAt: pastVisit.checkoutAt,
        decisionNote: 'Liberado. Carregue o celular antes da rota amanhã.',
      },
    })
  }

  // Hoje: dia em andamento conforme a hora atual (até agora)
  const nowMinute = Math.floor((Date.now() - localDayRange(today).start.getTime()) / 60_000)
  if (toDbDate(today).getUTCDay() !== 0) {
    // A jornada de hoje começa ~3h antes de agora, para o mapa mostrar posições recentes
    const startToday = Math.max(7 * 60, nowMinute - 170)
    await simulateDay(promotores[0]!.id, today, { 3: 'pending', 4: 'pending', 5: 'pending' }, reasons, nowMinute, tasks, startToday)
    await simulateDay(promotores[1]!.id, today, { 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending' }, reasons, nowMinute, tasks, startToday + 25)
    await ensureWorkDay(promotores[2]!.id, today)

    const outside = await prisma.visit.findFirst({ where: { promotorId: promotores[1]!.id, date: toDbDate(today), status: 'PENDENTE' }, orderBy: { position: 'asc' }, include: { client: true } })
    if (outside) {
      await prisma.permissionRequest.create({
        data: {
          type: 'CHECKIN_FORA_CERCA',
          date: toDbDate(today),
          promotorId: promotores[1]!.id,
          visitId: outside.id,
          reason: 'Estou na porta da loja mas o GPS marca a quase 400 m. Prédio alto do lado.',
          latitude: outside.client.latitude + 0.003,
          longitude: outside.client.longitude,
          createdById: promotores[1]!.id,
        },
      })
    }
  }

  // Auditorias dos vendedores nos dias anteriores
  const photos = await prisma.photo.findMany({
    where: { visit: { date: { in: pastDays.map(toDbDate) } } },
    include: { visit: { include: { client: true } } },
    orderBy: { takenAt: 'asc' },
  })
  const rejectReasons = ['Foto escura, não dá para ver a gôndola.', 'Foto não mostra a frente dos produtos.', 'Gôndola desorganizada, produtos misturados.', 'Foto tirada muito de perto.']
  let audits = 0
  for (const photo of photos) {
    const seller = photo.visit.client.sellerId === vend1.id ? vend1 : vend2
    if (rand() > (seller.id === vend1.id ? 0.85 : 0.5)) continue
    const reject = rand() < 0.18
    const audit = await prisma.photoAudit.create({
      data: {
        photoId: photo.id,
        auditorId: seller.id,
        status: reject ? 'REPROVADA' : 'APROVADA',
        justification: reject ? pick(rejectReasons) : null,
        createdAt: new Date(photo.takenAt.getTime() + between(2, 20) * 3_600_000),
      },
    })
    audits++
    // Supervisor confere parte das auditorias; algumas estão erradas
    if (rand() < 0.6) {
      const wrong = rand() < 0.2
      await prisma.auditReview.create({
        data: {
          auditId: audit.id,
          supervisorId: supervisor.id,
          verdict: wrong ? 'INCORRETA' : 'CORRETA',
          comment: wrong
            ? reject
              ? 'A foto está nítida e mostra a gôndola completa. Deveria ter sido aprovada.'
              : 'Há ruptura visível na segunda prateleira e a foto não registra isso. Deveria ter sido reprovada.'
            : null,
        },
      })
    }
    // Admin avalia parte das fotos
    if (rand() < 0.4) {
      await prisma.photo.update({
        where: { id: photo.id },
        data: { score: between(5, 10), reviewNotes: rand() < 0.3 ? 'Boa execução da gôndola.' : null, reviewedById: admin.id, reviewedAt: new Date() },
      })
    }
  }

  const counts = {
    usuarios: await prisma.user.count(),
    clientes: await prisma.client.count(),
    visitas: await prisma.visit.count(),
    fotos: await prisma.photo.count(),
    auditorias: audits,
    pings: await prisma.locationPing.count(),
  }
  console.log('[seed] concluído', counts)
  console.log('[seed] logins (senha 123456): admin, supervisor, vendedor1, vendedor2, promotor1, promotor2, promotor3')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
