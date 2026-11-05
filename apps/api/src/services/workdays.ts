import { isUniqueViolation, prisma, Prisma, type VisitModule, type VisitOrigin, type VisitStatus } from '../db'
import { toDbDate, todayIn } from '../lib/dates'
import { fallsOn, routeRule } from './route-frequency'
import { hasDueTask, loadTaskContext } from './tasks'
import { mergeModules, onlyActivities } from './visit-structure'

type Tx = Prisma.TransactionClient

/** Cliente no plano do dia: a posição na lista é a ordem do roteiro. */
export type PlannedVisit = { clientId: string; modules: VisitModule[] }

/**
 * Clientes do roteiro fixo que caem na data, na ordem de atendimento (dia da semana, frequência e estrutura de cada
 * cliente). Os do próprio dia vêm na ordem do roteiro; os "de X em X dias" cadastrados em outro dia, no fim.
 * Cliente que cai mais de uma vez no dia vira uma visita só, com as etapas somadas.
 */
export async function planRouteDay(db: Tx | typeof prisma, promotorId: string, date: string): Promise<PlannedVisit[]> {
  const weekday = toDbDate(date).getUTCDay()
  const items = await db.routeItem.findMany({
    where: { promotorId, client: { active: true }, OR: [{ weekday }, { frequency: 'DIAS' }] },
    orderBy: { position: 'asc' },
  })
  const due = items
    .filter((item) => fallsOn(routeRule(item), date))
    .sort((a, b) => Number(a.weekday !== weekday) - Number(b.weekday !== weekday) || a.weekday - b.weekday || a.position - b.position)
  const planned = new Map<string, VisitModule[]>()
  for (const item of due) planned.set(item.clientId, mergeModules(planned.get(item.clientId) ?? [], item.modules))
  const activityOnly = [...planned].filter(([, modules]) => onlyActivities(modules)).map(([clientId]) => clientId)
  if (activityOnly.length > 0) {
    const ctx = await loadTaskContext(promotorId, date, activityOnly)
    for (const clientId of activityOnly) if (!hasDueTask(ctx, clientId, date)) planned.delete(clientId)
  }
  return [...planned].map(([clientId, modules]) => ({ clientId, modules }))
}

/**
 * Trava, até o fim da transação, a geração do dia e a alteração do roteiro do promotor, para não rodarem ao mesmo
 * tempo: o dia gerado durante uma alteração sairia com o roteiro antigo.
 */
export async function lockPromotorDay(tx: Tx, promotorId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jornada:${promotorId}`}))`
}

/**
 * Garante a jornada do promotor na data, gerando as visitas a partir do roteiro fixo e das visitas pontuais
 * agendadas pelo supervisor. Depois de gerado, o dia só muda pelas alterações do roteiro salvas no painel
 * (syncTodayWithRoute, que não mexe no que o promotor já fez), por visitas pontuais, extras e substituições.
 */
export async function ensureWorkDay(promotorId: string, date: string) {
  const day = toDbDate(date)
  const existing = await prisma.workDay.findUnique({ where: { promotorId_date: { promotorId, date: day } } })
  if (existing) return existing

  try {
    return await prisma.$transaction(async (tx) => {
      await lockPromotorDay(tx, promotorId)
      // Outra requisição pode ter gerado o dia enquanto esta esperava a trava
      const generated = await tx.workDay.findUnique({ where: { promotorId_date: { promotorId, date: day } } })
      if (generated) return generated
      const routeClients = await planRouteDay(tx, promotorId, date)
      const scheduled = await tx.scheduledVisit.findMany({ where: { promotorId, date: day, client: { active: true } }, orderBy: { createdAt: 'asc' } })
      const workDay = await tx.workDay.create({
        data: {
          promotorId,
          date: day,
          visits: { create: routeClients.map(({ clientId, modules }, i) => ({ promotorId, clientId, date: day, position: i + 1, modules })) },
        },
      })
      // Visitas pontuais entram no fim; se o cliente já caiu no roteiro do dia, a pontual fica ligada a essa visita
      // e as etapas pedidas pelo supervisor se somam às do roteiro
      const routeVisits = scheduled.length ? await tx.visit.findMany({ where: { workDayId: workDay.id }, select: { id: true, clientId: true, modules: true } }) : []
      let position = routeClients.length
      for (const s of scheduled) {
        const routeVisit = routeVisits.find((v) => v.clientId === s.clientId)
        if (routeVisit) await tx.visit.update({ where: { id: routeVisit.id }, data: { modules: mergeModules(routeVisit.modules, s.modules) } })
        const visitId =
          routeVisit?.id ??
          (await tx.visit.create({
            data: { workDayId: workDay.id, promotorId, clientId: s.clientId, date: day, position: ++position, origin: 'PONTUAL', modules: s.modules },
          })).id
        await tx.scheduledVisit.update({ where: { id: s.id }, data: { visitId } })
      }
      return workDay
    })
  } catch (error) {
    // Duas requisições simultâneas tentando gerar o mesmo dia
    if (isUniqueViolation(error)) return prisma.workDay.findUniqueOrThrow({ where: { promotorId_date: { promotorId, date: day } } })
    throw error
  }
}

/** Gera a jornada do dia para todos os promotores ativos (roda no início do dia e ao abrir o mapa). */
export async function ensureWorkDaysForAll(date: string) {
  const promotores = await prisma.user.findMany({ where: { role: 'PROMOTOR', active: true }, select: { id: true } })
  for (const p of promotores) await ensureWorkDay(p.id, date)
}

type DayClient = { id: string; name: string }

/** O que uma alteração do roteiro fixo mudou no dia de hoje do promotor (para o painel mostrar). */
export type TodayRouteUpdate = {
  date: string
  /** O promotor já encerrou o roteiro de hoje: a alteração vale a partir do próximo dia */
  closed: boolean
  added: DayClient[]
  removed: DayClient[]
  /** Pendentes que continuam no dia com outra estrutura de atendimento */
  changed: DayClient[]
  /** Saíram do roteiro, mas continuam no dia como estão: já atendidos, justificados, em atendimento ou visita pontual */
  kept: DayClient[]
  /** A ordem dos pendentes mudou */
  reordered: boolean
}

const ROUTE_CHANGED_NOTE = 'O roteiro de hoje foi alterado pelo administrador.'

/**
 * Leva ao dia de hoje do promotor a alteração do roteiro fixo que acabou de ser gravada (na mesma transação, com
 * lockPromotorDay). Só os clientes do roteiro ainda pendentes (nem abertos nem justificados) mudam:
 *  - quem saiu do roteiro sai do dia; quem já foi atendido, justificado ou está em atendimento fica como está;
 *  - quem entrou ganha a visita no lugar dele na ordem do roteiro;
 *  - nova estrutura de atendimento vale para os pendentes;
 *  - se a ordem do roteiro mudou, os pendentes seguem a ordem nova nos lugares que já ocupavam na lista.
 * Extras, substituições e visitas pontuais ficam como estão (a pontual pendente vira visita do roteiro se o cliente
 * entrar nele, e volta a pontual se ele sair). `before` é o plano de hoje pelo roteiro de antes da alteração.
 */
export async function syncTodayWithRoute(tx: Tx, promotorId: string, before: PlannedVisit[]): Promise<TodayRouteUpdate | null> {
  const date = todayIn()
  const workDay = await tx.workDay.findUnique({ where: { promotorId_date: { promotorId, date: toDbDate(date) } } })
  // Dia ainda não gerado: quando for, já sai com o roteiro novo
  if (!workDay) return null
  const result: TodayRouteUpdate = { date, closed: false, added: [], removed: [], changed: [], kept: [], reordered: false }
  if (workDay.closedAt || workDay.endedAt) return { ...result, closed: true }

  const plan = await planRouteDay(tx, promotorId, date)
  const planOrder = new Map(plan.map((p, i) => [p.clientId, i]))
  const visits = await tx.visit.findMany({
    where: { workDayId: workDay.id },
    include: {
      client: { select: { id: true, name: true } },
      scheduledVisit: { select: { modules: true } },
      replacedBy: { select: { id: true } },
      requests: { where: { status: 'PENDENTE' }, select: { id: true } },
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })

  // Lista do dia como vai ficar; id vazio = visita nova
  type Entry = { id: string | null; clientId: string; origin: VisitOrigin; status: VisitStatus; position: number; modules: VisitModule[] }
  const entry = (v: (typeof visits)[number], changes: Partial<Entry> = {}): Entry => ({
    id: v.id,
    clientId: v.clientId,
    origin: v.origin,
    status: v.status,
    position: v.position,
    modules: v.modules,
    ...changes,
  })
  let list: Entry[] = visits.filter((v) => v.status !== 'CANCELADA').map((v) => entry(v))
  const toPlace: Entry[] = []
  const requestsToCancel: string[] = []
  let pendingChanged = false

  // Saíram do roteiro de hoje (o promotor pode ter aberto o atendimento agora: as mudanças conferem o status de novo)
  for (const v of visits) {
    if (v.origin !== 'ROTEIRO' || v.status === 'CANCELADA' || planOrder.has(v.clientId)) continue
    if (v.status !== 'PENDENTE') {
      result.kept.push(v.client)
      continue
    }
    if (v.scheduledVisit) {
      // Também era visita pontual do supervisor: continua no dia como pontual, no fim da lista
      const modules = v.scheduledVisit.modules
      const { count } = await tx.visit.updateMany({ where: { id: v.id, status: 'PENDENTE' }, data: { origin: 'PONTUAL', modules } })
      if (count > 0) {
        list = [...list.filter((e) => e.id !== v.id), entry(v, { origin: 'PONTUAL', modules })]
        pendingChanged = true
      }
      result.kept.push(v.client)
      continue
    }
    const { count } = await tx.visit.deleteMany({ where: { id: v.id, status: 'PENDENTE' } })
    if (count === 0) {
      result.kept.push(v.client)
      continue
    }
    list = list.filter((e) => e.id !== v.id)
    requestsToCancel.push(...v.requests.map((r) => r.id))
    result.removed.push(v.client)
    pendingChanged = true
  }

  // Entraram no roteiro de hoje ou mudaram de estrutura
  const newClients: string[] = []
  for (const p of plan) {
    const ofClient = visits.filter((v) => v.clientId === p.clientId)
    if (ofClient.length === 0) {
      toPlace.push({ id: null, clientId: p.clientId, origin: 'ROTEIRO', status: 'PENDENTE', position: 0, modules: p.modules })
      newClients.push(p.clientId)
      continue
    }
    const own = ofClient.find((v) => v.origin === 'ROTEIRO' && v.status !== 'CANCELADA')
    if (own) {
      if (own.status !== 'PENDENTE') continue
      const modules = mergeModules(p.modules, own.scheduledVisit?.modules ?? [])
      if (modules.join() === own.modules.join()) continue
      const { count } = await tx.visit.updateMany({ where: { id: own.id, status: 'PENDENTE' }, data: { modules } })
      if (count > 0) result.changed.push(own.client)
      continue
    }
    // Trocado por outro cliente hoje (substituição aprovada): não volta
    if (ofClient.some((v) => v.origin === 'ROTEIRO')) continue
    // Visita pontual ainda pendente: vira visita do roteiro, como na geração do dia, com as etapas somadas
    const pontual = ofClient.find((v) => v.origin === 'PONTUAL' && v.status === 'PENDENTE')
    if (pontual) {
      const modules = mergeModules(p.modules, pontual.modules)
      const { count } = await tx.visit.updateMany({ where: { id: pontual.id, status: 'PENDENTE' }, data: { origin: 'ROTEIRO', modules } })
      if (count > 0) {
        list = list.filter((e) => e.id !== pontual.id)
        toPlace.push(entry(pontual, { origin: 'ROTEIRO', modules }))
        result.added.push(pontual.client)
      }
    }
    // Já está no dia de outro jeito (extra, substituto ou pontual iniciada): fica como está
  }

  // Quem entrou vai logo depois do cliente que vem antes dele no roteiro (ou no lugar de quem foi trocado por
  // substituição); sem nenhum antes dele no dia, vai para o começo da lista
  const placeOf = (clientId: string) => {
    const i = list.findIndex((e) => e.clientId === clientId && e.origin === 'ROTEIRO')
    if (i >= 0) return i
    const swapped = visits.find((v) => v.clientId === clientId && v.origin === 'ROTEIRO' && v.status === 'CANCELADA' && v.replacedBy)
    return swapped ? list.findIndex((e) => e.id === swapped.replacedBy!.id) : -1
  }
  for (const e of toPlace.sort((a, b) => planOrder.get(a.clientId)! - planOrder.get(b.clientId)!)) {
    let after = -1
    for (let j = planOrder.get(e.clientId)! - 1; j >= 0 && after < 0; j--) after = placeOf(plan[j]!.clientId)
    list.splice(after + 1, 0, e)
  }
  if (toPlace.length > 0) pendingChanged = true

  // Ordem mudada no roteiro: os pendentes do roteiro trocam de lugar entre si; atendidos, extras e pontuais ficam onde estão
  const planned = new Set(plan.map((p) => p.clientId))
  const previous = new Set(before.map((p) => p.clientId))
  const orderChanged =
    before.filter((p) => planned.has(p.clientId)).map((p) => p.clientId).join() !== plan.filter((p) => previous.has(p.clientId)).map((p) => p.clientId).join()
  if (orderChanged) {
    const isPendingRoute = (e: Entry) => e.origin === 'ROTEIRO' && e.status === 'PENDENTE' && planOrder.has(e.clientId)
    const pendingOrder = () => list.filter(isPendingRoute).map((e) => e.clientId).join()
    const was = pendingOrder()
    const slots = list.flatMap((e, i) => (isPendingRoute(e) ? [i] : []))
    const ordered = slots.map((i) => list[i]!).sort((a, b) => planOrder.get(a.clientId)! - planOrder.get(b.clientId)!)
    slots.forEach((slot, k) => (list[slot] = ordered[k]!))
    result.reordered = pendingOrder() !== was
    if (result.reordered) pendingChanged = true
  }

  for (const [i, e] of list.entries()) {
    const position = i + 1
    if (!e.id) {
      await tx.visit.create({ data: { workDayId: workDay.id, promotorId, clientId: e.clientId, date: workDay.date, position, origin: 'ROTEIRO', modules: e.modules } })
    } else if (e.position !== position) {
      await tx.visit.update({ where: { id: e.id }, data: { position } })
    }
  }
  if (newClients.length > 0) {
    const names = await tx.client.findMany({ where: { id: { in: newClients } }, select: { id: true, name: true } })
    result.added.push(...newClients.map((id) => names.find((c) => c.id === id)!))
  }

  // Pedidos que perderam o sentido: os de clientes que saíram do dia e a troca de ordem pedida para a lista antiga
  if (requestsToCancel.length > 0) {
    await tx.permissionRequest.updateMany({
      where: { id: { in: requestsToCancel }, status: 'PENDENTE' },
      data: { status: 'CANCELADA', decisionNote: `${ROUTE_CHANGED_NOTE} O cliente saiu do roteiro.` },
    })
  }
  if (pendingChanged) {
    await tx.permissionRequest.updateMany({
      where: { promotorId, date: workDay.date, type: 'ALTERAR_ORDEM', status: 'PENDENTE' },
      data: { status: 'CANCELADA', decisionNote: `${ROUTE_CHANGED_NOTE} Peça a troca de ordem de novo, se precisar.` },
    })
  }
  return result
}
