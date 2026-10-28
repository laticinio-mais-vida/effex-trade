import { prisma, Prisma, type PhotoType, type Visit, type VisitModule } from '../db'
import { fromDbDate, minutesBetween, toDbDate, todayIn } from '../lib/dates'
import { badRequest, conflict, forbidden, notFound, ruleViolation } from '../lib/errors'
import { distanceMeters, formatDistance } from '../lib/geo'
import type { UploadedImage } from '../lib/multipart'
import type { LocationInput } from '../lib/validate'
import { productRef, serializePhoto, serializeVisit } from './serializers'
import { stampPhoto } from './photo-stamp'
import { getSettings, routeOrderEnforced, type Settings } from './settings'
import { removeUpload, saveUpload } from './storage'
import { loadTaskContext, tasksOfVisit, type TaskContext } from './tasks'
import { ensureWorkDay } from './workdays'

const visitInclude = {
  client: true,
  photos: { orderBy: { takenAt: 'asc' }, include: { products: { include: { product: true } } } },
  justificationReason: true,
  requests: { orderBy: { createdAt: 'desc' } },
  ruptures: { include: { product: true }, orderBy: { product: { name: 'asc' } } },
  taskCompletions: true,
  sessions: { orderBy: { checkinAt: 'asc' } },
  scheduledVisit: { include: { createdBy: { select: { name: true } } } },
} satisfies Prisma.VisitInclude

type Tx = Prisma.TransactionClient

async function loadOwnVisit(promotorId: string, visitId: string) {
  const visit = await prisma.visit.findUnique({ where: { id: visitId }, include: { client: true, workDay: true } })
  if (!visit || visit.promotorId !== promotorId) throw notFound('Visita')
  return visit
}

function assertToday(date: Date) {
  if (fromDbDate(date) !== todayIn()) throw conflict('Esta visita não é do dia de hoje.', 'FORA_DO_DIA')
}

function assertInProgress(visit: Visit) {
  if (visit.status !== 'EM_ATENDIMENTO') throw conflict('Abra o atendimento (check-in) antes de continuar.', 'STATUS_INVALIDO')
}

type LunchState = { lunchStartedAt: Date | null; lunchEndedAt: Date | null }
const onLunch = (wd: LunchState) => !!wd.lunchStartedAt && !wd.lunchEndedAt

/** Durante o almoço nenhuma atividade é permitida; a volta é a abertura (ou justificativa) do próximo cliente. */
function assertNotOnLunch(wd: LunchState) {
  if (onLunch(wd)) {
    throw ruleViolation('Você está no horário de almoço. Nenhuma atividade pode ser feita agora; a volta do almoço é a abertura do próximo cliente.', 'EM_ALMOCO')
  }
}

/** Origens que ficam fora da ordem do roteiro: incluídas no dia pelo promotor (extra) ou pelo supervisor (pontual). */
const OUTSIDE_ORDER = ['EXTRA', 'PONTUAL'] as const

/** Entra na ordem do roteiro: extras, pontuais e os liberados pelo supervisor ficam fora (atendidos a qualquer momento). */
const inRouteOrder = (v: { origin: string; routeOrderWaived: boolean }) => !(OUTSIDE_ORDER as readonly string[]).includes(v.origin) && !v.routeOrderWaived

/** Roteiro encerrado (pelo promotor ou pelo sistema). */
const isClosed = (wd: { closedAt: Date | null; endedAt: Date | null }) => !!(wd.closedAt ?? wd.endedAt)

/**
 * Ponto de fim do trabalho: horário da última atividade do dia (check-out, foto ou justificativa feita em campo).
 * O horário da foto é limitado ao recebimento, para não aceitar relógio adulterado.
 */
async function lastActivityAt(tx: Tx | typeof prisma, workDayId: string) {
  const visits = await tx.visit.findMany({
    where: { workDayId },
    select: { checkoutAt: true, justifiedAt: true, photos: { select: { takenAt: true, createdAt: true } } },
  })
  const times = visits.flatMap((v) => [
    v.checkoutAt?.getTime(),
    v.justifiedAt?.getTime(),
    ...v.photos.map((ph) => Math.min(ph.takenAt.getTime(), ph.createdAt.getTime())),
  ])
  const valid = times.filter((t): t is number => t != null)
  return valid.length ? new Date(Math.max(...valid)) : null
}

/** Produtos do mix do cliente (o que ele compra). */
async function clientMixIds(clientId: string) {
  const mix = await prisma.clientProduct.findMany({ where: { clientId, product: { active: true } }, select: { productId: true } })
  return new Set(mix.map((m) => m.productId))
}

/** Na foto de depois só entram produtos que o cliente compra (quando o mix está cadastrado). */
async function assertProductsInMix(clientId: string, productIds: string[]) {
  const mix = await clientMixIds(clientId)
  if (mix.size === 0) return
  if (productIds.some((id) => !mix.has(id))) {
    throw badRequest('Só é possível marcar produtos que este cliente compra.', 'PRODUTO_FORA_DO_MIX')
  }
}

// ---------------------------------------------------------------------------
// Estrutura do atendimento: fachada (no check-in) e as etapas da visita, em qualquer combinação:
// padrão (antes -> depois com produtos -> confirmação de ruptura), atividades extras e contagem de estoque
// ---------------------------------------------------------------------------

type SequenceInput = {
  modules: VisitModule[]
  photosWaived: boolean
  ruptureConfirmedAt: Date | null
  stockConfirmedAt: Date | null
  photos: { type: PhotoType; products?: unknown[] }[]
}

export type VisitStep = 'ANTES' | 'DEPOIS' | 'PRODUTOS' | 'RUPTURA' | 'ESTOQUE' | 'CHECKOUT'

/** Situação das etapas obrigatórias e qual o próximo passo do promotor. `enforced`: a sequência de fotos vale nesta visita. */
export function visitProgress(visit: SequenceInput, settings: Settings) {
  const before = visit.photos.filter((p) => p.type === 'ANTES').length
  const after = visit.photos.filter((p) => p.type === 'DEPOIS')
  const afterWithoutProducts = after.filter((p) => (p.products?.length ?? 0) === 0).length
  const enforced = visit.modules.includes('FOTOS') && settings.enforceVisitSequence && !visit.photosWaived
  const missing: VisitStep[] = []
  if (enforced) {
    if (before === 0) missing.push('ANTES')
    if (after.length === 0) missing.push('DEPOIS')
    else if (afterWithoutProducts > 0) missing.push('PRODUTOS')
    if (!visit.ruptureConfirmedAt) missing.push('RUPTURA')
  }
  // A contagem é feita fora do app; o promotor só confirma, e a dispensa de fotos não a dispensa
  if (visit.modules.includes('ESTOQUE') && !visit.stockConfirmedAt) missing.push('ESTOQUE')
  return {
    enforced,
    facade: visit.photos.some((p) => p.type === 'FACHADA'),
    before,
    after: after.length,
    afterWithoutProducts,
    ruptureConfirmed: !!visit.ruptureConfirmedAt,
    stockConfirmed: !!visit.stockConfirmedAt,
    missing,
    next: (missing[0] === 'PRODUTOS' ? 'DEPOIS' : (missing[0] ?? 'CHECKOUT')) as VisitStep,
  }
}

const stepMessages: Record<VisitStep, string> = {
  ANTES: 'tire a foto de antes',
  DEPOIS: 'tire as fotos de depois',
  PRODUTOS: 'identifique os produtos em todas as fotos de depois',
  RUPTURA: 'confirme as rupturas',
  ESTOQUE: 'confirme a contagem de estoque',
  CHECKOUT: '',
}

/** Fotos de antes e depois e a ruptura só existem na estrutura com a etapa padrão. */
function assertPhotoStep(visit: { modules: VisitModule[] }) {
  if (!visit.modules.includes('FOTOS')) {
    throw ruleViolation('Este atendimento não tem a etapa de fotos de antes, depois e ruptura.', 'ETAPA_INEXISTENTE')
  }
}

/** Qualquer mudança nas fotos de depois invalida a confirmação de ruptura (a ordem precisa ser refeita). */
async function resetRupture(tx: Tx, visitId: string) {
  await tx.visitRupture.deleteMany({ where: { visitId } })
  await tx.visit.update({ where: { id: visitId }, data: { ruptureConfirmedAt: null } })
}

async function assertProducts(productIds: string[]) {
  const unique = [...new Set(productIds)]
  const found = await prisma.product.count({ where: { id: { in: unique }, active: true } })
  if (found !== unique.length) throw badRequest('Um ou mais produtos não existem ou estão inativos.')
  return unique
}

// ---------------------------------------------------------------------------
// Consultas do promotor
// ---------------------------------------------------------------------------

type FullVisit = Prisma.VisitGetPayload<{ include: typeof visitInclude }>

/** Atividades da visita com a recorrência aplicada (só na estrutura com atividades extras). */
const visitTaskContext = (promotorId: string, visit: { date: Date; clientId: string }) => loadTaskContext(promotorId, fromDbDate(visit.date), [visit.clientId])

/** Atividades obrigatórias ainda não concluídas (as de foto não travam se o supervisor dispensou as fotos). */
function pendingRequiredTasks(visit: FullVisit, ctx: TaskContext) {
  return tasksOfVisit(ctx, visit).filter((t) => t.required && !t.done && !(t.requiresPhoto && visit.photosWaived))
}

function serializeFull(visit: FullVisit, settings: Settings, ctx: TaskContext) {
  return {
    ...serializeVisit(visit, settings.geofenceRadiusMeters),
    progress: visitProgress(visit, settings),
    tasks: tasksOfVisit(ctx, visit),
  }
}

const noTasks: TaskContext = { tasks: [], history: [] }

export async function getVisitDetail(promotorId: string, visitId: string) {
  await loadOwnVisit(promotorId, visitId)
  const settings = await getSettings(promotorId)
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
  return serializeFull(visit, settings, await visitTaskContext(promotorId, visit))
}

export async function getDayForPromotor(promotorId: string, date: string) {
  const today = todayIn()
  if (date > today) throw badRequest('O roteiro só pode ser aberto para hoje ou dias anteriores.')
  const settings = await getSettings(promotorId)
  const workDay =
    date === today
      ? await ensureWorkDay(promotorId, date)
      : await prisma.workDay.findUnique({ where: { promotorId_date: { promotorId, date: toDbDate(date) } } })

  const visits = workDay
    ? await prisma.visit.findMany({ where: { workDayId: workDay.id, status: { not: 'CANCELADA' } }, include: visitInclude, orderBy: { position: 'asc' } })
    : []
  const taskCtx = await loadTaskContext(promotorId, date, visits.map((v) => v.clientId))
  const reasons = await prisma.justificationReason.findMany({ where: { active: true }, orderBy: [{ position: 'asc' }, { label: 'asc' }] })

  const orderEnforced = routeOrderEnforced(settings, date) && !workDay?.routeOrderWaived
  const next = visits.find((v) => v.status === 'PENDENTE' && inRouteOrder(v))
  return {
    date,
    isToday: date === today,
    workDay: workDay
      ? {
          id: workDay.id,
          startedAt: workDay.startedAt,
          endedAt: workDay.endedAt,
          closedAt: workDay.closedAt,
          lunchStartedAt: workDay.lunchStartedAt,
          lunchEndedAt: workDay.lunchEndedAt,
          routeOrderWaived: workDay.routeOrderWaived,
        }
      : null,
    rules: {
      geofenceRadiusMeters: settings.geofenceRadiusMeters,
      enforceRouteOrder: orderEnforced,
      requireFacadePhotoOnCheckin: settings.requireFacadePhotoOnCheckin,
      enforceVisitSequence: settings.enforceVisitSequence,
      afterPhotoWarningMinutes: settings.afterPhotoWarningMinutes,
      lunchBreakEnabled: settings.lunchBreakEnabled,
      lunchAlertMinutes: settings.lunchAlertMinutes,
      requireCompleteRouteToEnd: settings.requireCompleteRouteToEnd,
      autoCloseForgottenVisit: settings.autoCloseForgottenVisit,
      requireGeofenceOnCheckout: settings.requireGeofenceOnCheckout,
      blockMockedLocation: settings.blockMockedLocation,
      maxLocationAccuracyMeters: settings.maxLocationAccuracyMeters,
      allowExtraVisits: settings.allowExtraVisits,
      maxExtraVisitsPerDay: settings.maxExtraVisitsPerDay,
      minVisitMinutes: settings.minVisitMinutes,
      justificationMinLength: settings.justificationMinLength,
      trackingIntervalMinutes: settings.trackingIntervalMinutes,
    },
    nextVisitId: orderEnforced ? (next?.id ?? null) : null,
    inProgressVisitId: visits.find((v) => v.status === 'EM_ATENDIMENTO')?.id ?? null,
    visits: visits.map((v) => serializeFull(v, settings, taskCtx)),
    reasons: reasons.map((r) => ({ id: r.id, label: r.label })),
  }
}

/**
 * Produtos para identificar nas fotos de depois: só os que o cliente compra (mix).
 * Sem mix cadastrado, mostra o catálogo inteiro para não travar o atendimento.
 */
export async function listProductsForVisit(promotorId: string, visitId: string | undefined, search: string | undefined) {
  let mixIds = new Set<string>()
  if (visitId) {
    const visit = await loadOwnVisit(promotorId, visitId)
    mixIds = await clientMixIds(visit.clientId)
  }
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(mixIds.size > 0 ? { id: { in: [...mixIds] } } : {}),
      ...(search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search } }, { brand: { contains: search, mode: 'insensitive' } }] }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 300,
  })
  return products
    .map((p) => ({ ...productRef(p), category: p.category, inMix: mixIds.has(p.id) }))
    .sort((a, b) => Number(b.inMix) - Number(a.inMix) || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Roteiro (jornada)
// ---------------------------------------------------------------------------

type DayJustification = { visitId: string; reasonId: string; text?: string }

/**
 * Encerra o roteiro do dia. Com a regra de roteiro completo, só encerra com todos os clientes
 * atendidos; os pendentes precisam vir justificados na mesma chamada.
 */
export async function endDay(promotorId: string, input: { location: LocationInput | null; justifications: DayJustification[] }) {
  const settings = await getSettings(promotorId)
  const workDay = await ensureWorkDay(promotorId, todayIn())
  if (isClosed(workDay)) throw conflict('O roteiro de hoje já foi encerrado.', 'ROTEIRO_ENCERRADO')
  const visits = await prisma.visit.findMany({ where: { workDayId: workDay.id, status: { in: ['PENDENTE', 'EM_ATENDIMENTO'] } }, include: { client: true } })
  if (visits.some((v) => v.status === 'EM_ATENDIMENTO')) {
    throw conflict('Finalize o atendimento em andamento antes de encerrar o roteiro.', 'ATENDIMENTO_EM_ANDAMENTO')
  }

  const pending = visits.filter((v) => v.status === 'PENDENTE')
  const byVisit = new Map(input.justifications.map((j) => [j.visitId, j]))
  if (input.justifications.some((j) => !pending.some((v) => v.id === j.visitId))) {
    throw conflict('Uma das visitas justificadas não está mais pendente. Atualize o roteiro.', 'ROTEIRO_MUDOU')
  }
  const missing = pending.filter((v) => !byVisit.has(v.id))
  if (settings.requireCompleteRouteToEnd && missing.length > 0) {
    throw ruleViolation(
      `O roteiro ainda tem ${missing.length} ${missing.length === 1 ? 'cliente sem atendimento' : 'clientes sem atendimento'}. Para encerrar agora, justifique cada um.`,
      'ROTEIRO_INCOMPLETO',
      { pending: missing.map((v) => ({ visitId: v.id, position: v.position, clientName: v.client.name })) },
    )
  }

  const reasons = await prisma.justificationReason.findMany({ where: { id: { in: input.justifications.map((j) => j.reasonId) }, active: true } })
  for (const j of input.justifications) {
    if (!reasons.some((r) => r.id === j.reasonId)) throw badRequest('Motivo de justificativa inválido.')
    if ((j.text?.trim().length ?? 0) < settings.justificationMinLength) {
      const client = pending.find((v) => v.id === j.visitId)?.client.name
      throw ruleViolation(`Descreva a justificativa de ${client} com pelo menos ${settings.justificationMinLength} caracteres.`, 'JUSTIFICATIVA_CURTA', { visitId: j.visitId })
    }
  }

  const now = new Date()
  // Ponto de fim = última atividade em campo, calculada antes das justificativas feitas no encerramento
  const lastActivity = await lastActivityAt(prisma, workDay.id)
  return prisma.$transaction(async (tx) => {
    for (const j of input.justifications) {
      await tx.visit.update({
        where: { id: j.visitId },
        data: {
          status: 'JUSTIFICADA',
          justificationReasonId: j.reasonId,
          justificationText: j.text!.trim(),
          justifiedAt: now,
          justifyLat: input.location?.latitude,
          justifyLng: input.location?.longitude,
        },
      })
    }
    return tx.workDay.update({
      where: { id: workDay.id },
      data: {
        endedAt: lastActivity ?? now,
        closedAt: now,
        endLat: input.location?.latitude,
        endLng: input.location?.longitude,
        ...(onLunch(workDay) ? { lunchEndedAt: now } : {}),
      },
    })
  })
}

/** Abre o almoço. Só depois do primeiro atendimento, uma vez por dia e sem atendimento aberto. */
export async function startLunch(promotorId: string, loc: LocationInput | null) {
  const settings = await getSettings(promotorId)
  if (!settings.lunchBreakEnabled) throw forbidden('O bloqueio de almoço está desativado nas regras.', 'ALMOCO_DESATIVADO')
  const workDay = await ensureWorkDay(promotorId, todayIn())
  if (isClosed(workDay)) throw conflict('O roteiro de hoje já foi encerrado.', 'ROTEIRO_ENCERRADO')
  if (!workDay.startedAt) throw conflict('O almoço só pode ser aberto depois do primeiro atendimento do dia.', 'ROTEIRO_NAO_INICIADO')
  if (workDay.lunchStartedAt) throw conflict('O almoço de hoje já foi registrado.', 'ALMOCO_JA_FEITO')
  const open = await prisma.visit.findFirst({ where: { workDayId: workDay.id, status: 'EM_ATENDIMENTO' }, include: { client: true } })
  if (open) throw conflict(`Encerre o atendimento em ${open.client.name} antes de sair para o almoço.`, 'ATENDIMENTO_EM_ANDAMENTO', { visitId: open.id })
  return prisma.workDay.update({
    where: { id: workDay.id },
    data: { lunchStartedAt: new Date(), lunchLat: loc?.latitude, lunchLng: loc?.longitude },
  })
}

/** Roteiros de dias anteriores que ficaram abertos: o ponto final é a última atividade daquele dia. */
async function closeForgottenWorkDays(tx: Tx, promotorId: string, today: string) {
  const open = await tx.workDay.findMany({ where: { promotorId, date: { lt: toDbDate(today) }, startedAt: { not: null }, closedAt: null, endedAt: null } })
  for (const wd of open) {
    const last = await lastActivityAt(tx, wd.id)
    await tx.workDay.update({
      where: { id: wd.id },
      data: { endedAt: last ?? wd.startedAt, closedAt: new Date(), ...(onLunch(wd) ? { lunchEndedAt: last ?? wd.lunchStartedAt } : {}) },
    })
  }
}

/**
 * Encerra um atendimento esquecido: a saída vira o horário da última foto tirada nele
 * (limitado entre o check-in e o recebimento da foto, para não aceitar horário adulterado).
 * Não exige cerca eletrônica.
 */
async function autoCloseVisit(tx: Tx, visit: Visit) {
  const session = await tx.visitSession.findFirst({ where: { visitId: visit.id, checkoutAt: null }, orderBy: { checkinAt: 'desc' } })
  const checkin = session?.checkinAt ?? visit.checkinAt ?? new Date()
  // Última foto desta abertura (numa reabertura, as fotos das aberturas anteriores não contam)
  const last = await tx.photo.findFirst({ where: { visitId: visit.id, createdAt: { gte: checkin } }, orderBy: { takenAt: 'desc' } })
  let checkoutAt = checkin
  if (last) {
    const taken = Math.min(last.takenAt.getTime(), last.createdAt.getTime())
    checkoutAt = new Date(Math.max(taken, checkin.getTime()))
  }
  const checkoutLat = last?.latitude ?? session?.checkinLat ?? visit.checkinLat
  const checkoutLng = last?.longitude ?? session?.checkinLng ?? visit.checkinLng
  if (session) await tx.visitSession.update({ where: { id: session.id }, data: { checkoutAt, checkoutLat, checkoutLng, autoClosed: true } })
  await tx.visit.update({ where: { id: visit.id }, data: { status: 'CONCLUIDA', autoClosed: true, checkoutAt, checkoutLat, checkoutLng } })
  return checkoutAt
}

export async function addExtraVisit(promotorId: string, clientId: string) {
  const settings = await getSettings(promotorId)
  if (!settings.allowExtraVisits) throw forbidden('A inclusão de clientes extras está desativada nas regras.', 'EXTRA_DESATIVADO')
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client || !client.active) throw notFound('Cliente')

  const date = todayIn()
  const workDay = await ensureWorkDay(promotorId, date)
  if (isClosed(workDay)) throw conflict('O roteiro de hoje já foi encerrado.', 'ROTEIRO_ENCERRADO')
  const existing = await prisma.visit.findFirst({ where: { workDayId: workDay.id, clientId, status: { in: ['PENDENTE', 'EM_ATENDIMENTO', 'CONCLUIDA'] } } })
  if (existing) {
    throw conflict(
      existing.status === 'CONCLUIDA'
        ? `Você já atendeu ${client.name} hoje. Para voltar a ele, reabra o atendimento e continue de onde parou.`
        : `${client.name} já está no seu roteiro de hoje.`,
      'CLIENTE_NO_ROTEIRO',
      { visitId: existing.id, status: existing.status },
    )
  }
  const extras = await prisma.visit.count({ where: { workDayId: workDay.id, origin: 'EXTRA', status: { not: 'CANCELADA' } } })
  if (extras >= settings.maxExtraVisitsPerDay) throw ruleViolation(`Limite de ${settings.maxExtraVisitsPerDay} clientes extras por dia atingido.`, 'LIMITE_EXTRAS')

  const last = await prisma.visit.aggregate({ where: { workDayId: workDay.id }, _max: { position: true } })
  const visit = await prisma.visit.create({
    data: { workDayId: workDay.id, promotorId, clientId, date: toDbDate(date), position: (last._max.position ?? 0) + 1, origin: 'EXTRA' },
    include: visitInclude,
  })
  return serializeFull(visit, settings, await visitTaskContext(promotorId, visit))
}

export async function removeExtraVisit(promotorId: string, visitId: string) {
  const visit = await loadOwnVisit(promotorId, visitId)
  if (visit.origin !== 'EXTRA') throw forbidden('Somente clientes extras podem ser removidos. Para tirar um cliente do roteiro, justifique ou peça substituição.', 'NAO_EXTRA')
  if (visit.status !== 'PENDENTE') throw conflict('Este atendimento já foi iniciado e não pode ser removido.', 'STATUS_INVALIDO')
  await prisma.visit.delete({ where: { id: visitId } })
}

// ---------------------------------------------------------------------------
// Abertura e encerramento do atendimento
// ---------------------------------------------------------------------------

type Facade = (UploadedImage & { takenAt?: Date }) | null

/**
 * Abre o atendimento (check-in). Exige estar na cerca, na ordem do roteiro e com a foto da fachada.
 * O roteiro do dia começa no primeiro check-in. Atendimento esquecido aberto é encerrado sozinho.
 */
export function checkin(promotorId: string, visitId: string, loc: LocationInput, facade: Facade) {
  return openVisit(promotorId, visitId, loc, facade, 'checkin')
}

/**
 * Reabre um cliente já atendido no dia para continuar de onde parou (fotos, atividades e passos
 * continuam feitos). É uma nova abertura: exige cerca e foto da fachada; o tempo no cliente soma as aberturas.
 */
export function reopenVisit(promotorId: string, visitId: string, loc: LocationInput, facade: Facade) {
  return openVisit(promotorId, visitId, loc, facade, 'reopen')
}

async function openVisit(promotorId: string, visitId: string, loc: LocationInput, facade: Facade, mode: 'checkin' | 'reopen') {
  const settings = await getSettings(promotorId)
  const visit = await loadOwnVisit(promotorId, visitId)
  assertToday(visit.date)
  const expected = mode === 'checkin' ? 'PENDENTE' : 'CONCLUIDA'
  if (visit.status !== expected) {
    throw conflict(mode === 'checkin' ? 'Esta visita não está pendente.' : 'Só é possível reabrir um atendimento concluído hoje.', 'STATUS_INVALIDO')
  }
  if (isClosed(visit.workDay)) throw conflict('O roteiro de hoje já foi encerrado.', 'ROTEIRO_ENCERRADO')

  if (loc.mocked && settings.blockMockedLocation) {
    throw ruleViolation('Localização simulada detectada. Desative apps de GPS falso para continuar.', 'GPS_SIMULADO')
  }
  if (settings.maxLocationAccuracyMeters > 0 && loc.accuracy != null && loc.accuracy > settings.maxLocationAccuracyMeters) {
    throw ruleViolation(`Sinal de GPS impreciso (${Math.round(loc.accuracy)} m). Vá para um local aberto e tente de novo.`, 'GPS_IMPRECISO', {
      accuracy: Math.round(loc.accuracy),
      max: settings.maxLocationAccuracyMeters,
    })
  }

  const open = await prisma.visit.findMany({ where: { promotorId, status: 'EM_ATENDIMENTO', id: { not: visit.id } }, include: { client: true } })
  if (open.length > 0 && !settings.autoCloseForgottenVisit) {
    throw conflict(`Finalize o atendimento em ${open[0]!.client.name} antes de iniciar outro.`, 'ATENDIMENTO_EM_ANDAMENTO', { visitId: open[0]!.id })
  }

  if (mode === 'checkin' && routeOrderEnforced(settings, fromDbDate(visit.date)) && !visit.workDay.routeOrderWaived && inRouteOrder(visit)) {
    const next = await prisma.visit.findFirst({
      where: { workDayId: visit.workDayId, status: 'PENDENTE', origin: { notIn: [...OUTSIDE_ORDER] }, routeOrderWaived: false },
      orderBy: { position: 'asc' },
      include: { client: true },
    })
    if (next && next.id !== visit.id) {
      throw conflict(`Siga a ordem do roteiro: o próximo cliente é ${next.client.name}. Para mudar a ordem, peça liberação ao supervisor.`, 'FORA_DA_ORDEM', {
        nextVisitId: next.id,
      })
    }
  }

  const radius = visit.client.geofenceRadius ?? settings.geofenceRadiusMeters
  const distance = distanceMeters(loc.latitude, loc.longitude, visit.client.latitude, visit.client.longitude)
  if (distance > radius && !visit.geofenceWaived) {
    throw ruleViolation(
      `Você está a ${formatDistance(distance)} do cliente. O check-in só é permitido a até ${radius} m. Se estiver no local, peça liberação ao supervisor.`,
      'FORA_DA_CERCA',
      { distance: Math.round(distance), radius },
    )
  }

  if (settings.requireFacadePhotoOnCheckin && !visit.photosWaived && !facade) {
    throw ruleViolation(`Tire a foto da fachada da loja para ${mode === 'checkin' ? 'abrir' : 'reabrir'} o atendimento.`, 'FOTO_FACHADA')
  }

  const now = new Date()
  const facadeTakenAt = facade?.takenAt && facade.takenAt <= now ? facade.takenAt : now
  const facadePath = facade
    ? await saveUpload(await stampPhoto(facade.buffer, await stampInfo(promotorId, visit.client, 'FACHADA', facadeTakenAt)), facade.extension)
    : null
  try {
    const result = await prisma.$transaction(async (tx) => {
      const { count } = await tx.visit.updateMany({
        where: { id: visit.id, status: expected },
        data:
          mode === 'checkin'
            ? {
                status: 'EM_ATENDIMENTO',
                checkinAt: now,
                checkinLat: loc.latitude,
                checkinLng: loc.longitude,
                checkinAccuracy: loc.accuracy,
                checkinDistance: Math.round(distance),
              }
            : // Reabertura: mantém o primeiro check-in; o check-out volta a ficar em aberto
              { status: 'EM_ATENDIMENTO', checkoutAt: null, checkoutLat: null, checkoutLng: null, checkoutDistance: null },
      })
      if (count === 0) throw conflict('O atendimento mudou enquanto você abria. Atualize a tela.', 'STATUS_INVALIDO')
      await tx.visitSession.create({
        data: {
          visitId: visit.id,
          checkinAt: now,
          checkinLat: loc.latitude,
          checkinLng: loc.longitude,
          checkinAccuracy: loc.accuracy,
          checkinDistance: Math.round(distance),
        },
      })

      const autoClosed = []
      for (const o of open) {
        const checkoutAt = await autoCloseVisit(tx, o)
        autoClosed.push({ visitId: o.id, clientName: o.client.name, checkoutAt })
      }
      await closeForgottenWorkDays(tx, promotorId, todayIn())
      // O roteiro (ponto de início) só começa na abertura do primeiro atendimento
      await tx.workDay.updateMany({ where: { id: visit.workDayId, startedAt: null }, data: { startedAt: now, startLat: loc.latitude, startLng: loc.longitude } })
      // A abertura do próximo cliente é a volta do almoço
      const lunch = await tx.workDay.updateMany({ where: { id: visit.workDayId, lunchStartedAt: { not: null }, lunchEndedAt: null }, data: { lunchEndedAt: now } })
      if (facadePath) {
        await tx.photo.create({
          data: {
            visitId: visit.id,
            type: 'FACHADA',
            path: facadePath,
            takenAt: facadeTakenAt,
            latitude: loc.latitude,
            longitude: loc.longitude,
          },
        })
      }
      return { autoClosed, lunchEndedAt: lunch.count > 0 ? now : null, visit: await tx.visit.findUniqueOrThrow({ where: { id: visit.id }, include: visitInclude }) }
    })
    return { ...serializeFull(result.visit, settings, await visitTaskContext(promotorId, visit)), autoClosedVisits: result.autoClosed, lunchEndedAt: result.lunchEndedAt, reopened: mode === 'reopen' }
  } catch (error) {
    if (facadePath) await removeUpload(facadePath)
    throw error
  }
}

/** A localização só é obrigatória quando a regra exige cerca no check-out (GPS falhando não trava o promotor). */
export async function checkout(promotorId: string, visitId: string, loc: LocationInput | null, notes?: string) {
  const settings = await getSettings(promotorId)
  const visit = await loadOwnVisit(promotorId, visitId)
  if (visit.status !== 'EM_ATENDIMENTO' || !visit.checkinAt) throw conflict('Não há atendimento em andamento nesta visita.', 'STATUS_INVALIDO')

  assertNotOnLunch(visit.workDay)
  const full = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
  const progress = visitProgress(full, settings)
  if (progress.missing.length > 0) {
    throw ruleViolation(`Antes do check-out, ${progress.missing.map((m) => stepMessages[m]).join(', ')}.`, 'SEQUENCIA_INCOMPLETA', { missing: progress.missing })
  }
  const taskCtx = await visitTaskContext(promotorId, visit)
  const pendingTasks = pendingRequiredTasks(full, taskCtx)
  if (pendingTasks.length > 0) {
    throw ruleViolation(
      `Conclua ${pendingTasks.length === 1 ? 'a atividade obrigatória' : 'as atividades obrigatórias'} antes do check-out: ${pendingTasks.map((t) => t.title).join('; ')}.`,
      'ATIVIDADE_PENDENTE',
      { tasks: pendingTasks.map((t) => ({ id: t.id, title: t.title, requiresPhoto: t.requiresPhoto })) },
    )
  }

  const now = new Date()
  const session = full.sessions.find((x) => !x.checkoutAt)
  // Tempo mínimo vale para a abertura atual (numa reabertura, conta desde a reabertura)
  const minutes = minutesBetween(session?.checkinAt ?? visit.checkinAt, now)
  if (settings.minVisitMinutes > 0 && minutes < settings.minVisitMinutes) {
    throw ruleViolation(`O tempo mínimo no cliente é de ${settings.minVisitMinutes} min (agora: ${Math.floor(minutes)} min).`, 'TEMPO_MINIMO', {
      minutes,
      min: settings.minVisitMinutes,
    })
  }

  const radius = visit.client.geofenceRadius ?? settings.geofenceRadiusMeters
  const distance = loc ? distanceMeters(loc.latitude, loc.longitude, visit.client.latitude, visit.client.longitude) : null
  if (settings.requireGeofenceOnCheckout && !visit.geofenceWaived) {
    if (distance == null) throw ruleViolation('Ative o GPS: o check-out precisa confirmar que você está no cliente.', 'LOCALIZACAO_OBRIGATORIA')
    if (distance > radius) {
      throw ruleViolation(`Você está a ${formatDistance(distance)} do cliente. O check-out precisa ser feito no local.`, 'FORA_DA_CERCA', {
        distance: Math.round(distance),
        radius,
      })
    }
  }

  const checkoutData = { checkoutAt: now, checkoutLat: loc?.latitude, checkoutLng: loc?.longitude, checkoutDistance: distance == null ? null : Math.round(distance) }
  const updated = await prisma.$transaction(async (tx) => {
    if (session) await tx.visitSession.update({ where: { id: session.id }, data: checkoutData })
    return tx.visit.update({
      where: { id: visitId },
      data: { status: 'CONCLUIDA', ...checkoutData, notes: notes ?? visit.notes },
      include: visitInclude,
    })
  })
  return serializeFull(updated, settings, taskCtx)
}

export async function justify(promotorId: string, visitId: string, input: { reasonId: string; text?: string; latitude?: number; longitude?: number }) {
  const settings = await getSettings(promotorId)
  const visit = await loadOwnVisit(promotorId, visitId)
  assertToday(visit.date)
  if (visit.status !== 'PENDENTE' && visit.status !== 'EM_ATENDIMENTO') throw conflict('Esta visita já foi finalizada.', 'STATUS_INVALIDO')

  const reason = await prisma.justificationReason.findUnique({ where: { id: input.reasonId } })
  if (!reason || !reason.active) throw badRequest('Motivo de justificativa inválido.')
  const text = input.text?.trim() ?? ''
  if (text.length < settings.justificationMinLength) {
    throw ruleViolation(`Descreva a justificativa com pelo menos ${settings.justificationMinLength} caracteres.`, 'JUSTIFICATIVA_CURTA')
  }

  // Cliente fechado depois do almoço: a justificativa é a volta do almoço e precisa ser feita na cerca
  // deste cliente ou na do próximo cliente do roteiro
  if (onLunch(visit.workDay)) {
    if (input.latitude == null || input.longitude == null) {
      throw ruleViolation('Ative o GPS: a volta do almoço precisa confirmar que você está no cliente.', 'LOCALIZACAO_OBRIGATORIA')
    }
    const here = { latitude: input.latitude, longitude: input.longitude }
    const inside = (c: { latitude: number; longitude: number; geofenceRadius: number | null }) =>
      distanceMeters(here.latitude, here.longitude, c.latitude, c.longitude) <= (c.geofenceRadius ?? settings.geofenceRadiusMeters)
    let allowed = visit.geofenceWaived || inside(visit.client)
    if (!allowed) {
      const others = await prisma.visit.findMany({
        where: { workDayId: visit.workDayId, status: 'PENDENTE', id: { not: visit.id } },
        include: { client: true },
        orderBy: { position: 'asc' },
      })
      const next = others.find((o) => o.position > visit.position) ?? others[0]
      allowed = !!next && inside(next.client)
    }
    if (!allowed) {
      const distance = distanceMeters(here.latitude, here.longitude, visit.client.latitude, visit.client.longitude)
      throw ruleViolation(
        `Você está a ${formatDistance(distance)} do cliente. Durante o almoço, a justificativa (volta do almoço) precisa ser feita na cerca deste cliente ou do próximo cliente do roteiro.`,
        'FORA_DA_CERCA',
        { distance: Math.round(distance), radius: visit.client.geofenceRadius ?? settings.geofenceRadiusMeters },
      )
    }
  }

  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    // A justificativa durante o almoço encerra o almoço
    await tx.workDay.updateMany({ where: { id: visit.workDayId, lunchStartedAt: { not: null }, lunchEndedAt: null }, data: { lunchEndedAt: now } })
    return tx.visit.update({
      where: { id: visitId },
      data: {
        status: 'JUSTIFICADA',
        justificationReasonId: reason.id,
        justificationText: text,
        justifiedAt: now,
        justifyLat: input.latitude,
        justifyLng: input.longitude,
      },
      include: visitInclude,
    })
  })
  return serializeFull(updated, settings, noTasks)
}

/** Conclui uma atividade extra que não exige foto (as de foto concluem ao enviar a foto). */
export async function completeTask(promotorId: string, visitId: string, taskId: string, notes?: string) {
  const visit = await loadOwnVisit(promotorId, visitId)
  assertInProgress(visit)
  assertNotOnLunch(visit.workDay)
  const full = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
  const task = tasksOfVisit(await visitTaskContext(promotorId, visit), full).find((t) => t.id === taskId)
  if (!task) throw notFound('Atividade extra')
  if (task.requiresPhoto && !visit.photosWaived) throw ruleViolation('Esta atividade exige foto: conclua tirando a foto da atividade.', 'FOTO_OBRIGATORIA')
  await prisma.taskCompletion.upsert({
    where: { taskId_visitId: { taskId, visitId } },
    create: { taskId, visitId, notes: notes?.trim() || null },
    update: { notes: notes?.trim() || null, completedAt: new Date() },
  })
  return getVisitDetail(promotorId, visitId)
}

/** Etapa de contagem de estoque: a contagem é feita fora do app; o promotor só confirma que fez. */
export async function confirmStockCount(promotorId: string, visitId: string) {
  const visit = await loadOwnVisit(promotorId, visitId)
  assertInProgress(visit)
  assertNotOnLunch(visit.workDay)
  if (!visit.modules.includes('ESTOQUE')) throw ruleViolation('Este atendimento não tem a etapa de contagem de estoque.', 'ETAPA_INEXISTENTE')
  if (!visit.stockConfirmedAt) await prisma.visit.update({ where: { id: visitId }, data: { stockConfirmedAt: new Date() } })
  return getVisitDetail(promotorId, visitId)
}

// ---------------------------------------------------------------------------
// Fotos, produtos e ruptura
// ---------------------------------------------------------------------------

/** Dados gravados na faixa da foto (data e hora, tipo, cliente e promotor). */
async function stampInfo(promotorId: string, client: { name: string; code: string | null }, type: PhotoType, takenAt: Date) {
  const promotor = await prisma.user.findUnique({ where: { id: promotorId }, select: { name: true } })
  return { takenAt, type, clientName: client.name, clientCode: client.code, promotorName: promotor?.name ?? '' }
}

export async function addPhoto(
  promotorId: string,
  visitId: string,
  file: UploadedImage,
  input: {
    type: PhotoType
    taskId?: string
    notes?: string
    meta?: Record<string, unknown>
    latitude?: number
    longitude?: number
    takenAt?: Date
    productIds?: string[]
  },
) {
  const settings = await getSettings(promotorId)
  const visit = await loadOwnVisit(promotorId, visitId)
  assertInProgress(visit)
  assertNotOnLunch(visit.workDay)
  if (input.type === 'FACHADA') throw badRequest('A foto da fachada é tirada na abertura do atendimento.')
  if (input.type === 'ANTES' || input.type === 'DEPOIS') assertPhotoStep(visit)
  if (input.productIds?.length && input.type !== 'DEPOIS') throw badRequest('Produtos só são identificados nas fotos de depois.')

  const photos = await prisma.photo.findMany({ where: { visitId }, select: { type: true } })
  const enforced = settings.enforceVisitSequence && !visit.photosWaived
  if (enforced && input.type === 'ANTES' && photos.some((p) => p.type === 'DEPOIS')) {
    throw ruleViolation('A foto de antes vem antes das fotos de depois. Siga a ordem do atendimento.', 'SEQUENCIA')
  }
  if (enforced && input.type === 'DEPOIS' && !photos.some((p) => p.type === 'ANTES')) {
    throw ruleViolation('Tire a foto de antes primeiro.', 'SEQUENCIA')
  }
  if (enforced && input.type === 'DEPOIS' && !input.productIds?.length) {
    throw ruleViolation('Identifique os produtos que aparecem na foto de depois.', 'PRODUTOS_NAO_IDENTIFICADOS')
  }
  const productIds = input.productIds?.length ? await assertProducts(input.productIds) : []
  await assertProductsInMix(visit.clientId, productIds)

  if (input.taskId) {
    const full = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
    const task = tasksOfVisit(await visitTaskContext(promotorId, visit), full).find((t) => t.id === input.taskId)
    if (!task) throw badRequest('Atividade extra não encontrada para este cliente.')
  }

  const now = new Date()
  const takenAt = input.takenAt && input.takenAt <= now ? input.takenAt : now
  const path = await saveUpload(await stampPhoto(file.buffer, await stampInfo(promotorId, visit.client, input.type, takenAt)), file.extension)
  const photo = await prisma.$transaction(async (tx) => {
    const created = await tx.photo.create({
      data: {
        visitId,
        type: input.type,
        taskId: input.taskId,
        path,
        takenAt,
        latitude: input.latitude,
        longitude: input.longitude,
        notes: input.notes,
        meta: input.meta as Prisma.InputJsonValue | undefined,
        products: { create: productIds.map((productId) => ({ productId })) },
      },
      include: { products: { include: { product: true } } },
    })
    if (input.type === 'DEPOIS') await resetRupture(tx, visitId)
    // A foto da atividade extra conclui a atividade
    if (input.taskId) {
      await tx.taskCompletion.upsert({
        where: { taskId_visitId: { taskId: input.taskId, visitId } },
        create: { taskId: input.taskId, visitId, notes: input.notes },
        update: {},
      })
    }
    return created
  })
  return serializePhoto(photo)
}

export async function setPhotoProducts(promotorId: string, photoId: string, productIds: string[]) {
  const settings = await getSettings(promotorId)
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { visit: { include: { workDay: true } } } })
  if (!photo || photo.visit.promotorId !== promotorId) throw notFound('Foto')
  assertInProgress(photo.visit)
  assertNotOnLunch(photo.visit.workDay)
  if (photo.type !== 'DEPOIS') throw badRequest('Produtos só são identificados nas fotos de depois.')
  if (settings.enforceVisitSequence && !photo.visit.photosWaived && productIds.length === 0) {
    throw ruleViolation('Marque ao menos um produto que aparece na foto.', 'PRODUTOS_NAO_IDENTIFICADOS')
  }
  const ids = await assertProducts(productIds)
  await assertProductsInMix(photo.visit.clientId, ids)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.photoProduct.deleteMany({ where: { photoId } })
    await tx.photoProduct.createMany({ data: ids.map((productId) => ({ photoId, productId })) })
    await resetRupture(tx, photo.visitId)
    return tx.photo.findUniqueOrThrow({ where: { id: photoId }, include: { products: { include: { product: true } } } })
  })
  return serializePhoto(updated)
}

export async function deletePhoto(promotorId: string, photoId: string) {
  const settings = await getSettings(promotorId)
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { visit: true, _count: { select: { audits: true } } } })
  if (!photo || photo.visit.promotorId !== promotorId) throw notFound('Foto')
  if (photo.visit.status !== 'EM_ATENDIMENTO') throw conflict('Só é possível apagar fotos durante o atendimento.', 'STATUS_INVALIDO')
  if (photo._count.audits > 0) throw conflict('Esta foto já foi auditada e não pode ser apagada.', 'FOTO_AUDITADA')
  if (photo.type === 'FACHADA') throw conflict('A foto da fachada registra a abertura do atendimento e não pode ser apagada.', 'FOTO_FACHADA')
  if (photo.type === 'ANTES' && settings.enforceVisitSequence && !photo.visit.photosWaived) {
    const [before, after] = await Promise.all([
      prisma.photo.count({ where: { visitId: photo.visitId, type: 'ANTES' } }),
      prisma.photo.count({ where: { visitId: photo.visitId, type: 'DEPOIS' } }),
    ])
    if (before === 1 && after > 0) throw ruleViolation('Apague as fotos de depois antes de apagar a única foto de antes.', 'SEQUENCIA')
  }
  await prisma.$transaction(async (tx) => {
    await tx.photo.delete({ where: { id: photoId } })
    if (photo.type === 'DEPOIS') await resetRupture(tx, photo.visitId)
    // Sem foto, a atividade que exige foto volta a ficar pendente
    if (photo.taskId) {
      const task = await tx.task.findUnique({ where: { id: photo.taskId } })
      const remaining = await tx.photo.count({ where: { visitId: photo.visitId, taskId: photo.taskId } })
      if (task?.requiresPhoto && remaining === 0) await tx.taskCompletion.deleteMany({ where: { taskId: photo.taskId, visitId: photo.visitId } })
    }
  })
  await removeUpload(photo.path)
}

/**
 * Contraste da ruptura: produtos do mix do cliente que não foram identificados em nenhuma foto de depois.
 */
async function ruptureDiff(visitId: string) {
  const visit = await prisma.visit.findUniqueOrThrow({
    where: { id: visitId },
    include: {
      photos: { where: { type: 'DEPOIS' }, include: { products: { include: { product: true } } } },
      ruptures: { include: { product: true } },
      client: { include: { mix: { include: { product: true } } } },
    },
  })
  const identified = new Map(visit.photos.flatMap((p) => p.products.map((pp) => [pp.productId, pp.product] as const)))
  const mix = visit.client.mix.map((m) => m.product).filter((p) => p.active)
  const missing = mix.filter((p) => !identified.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))
  return { visit, mix, identified: [...identified.values()], missing }
}

export async function getRupture(promotorId: string, visitId: string) {
  await loadOwnVisit(promotorId, visitId)
  const { visit, mix, identified, missing } = await ruptureDiff(visitId)
  return {
    mixSize: mix.length,
    hasMix: mix.length > 0,
    identified: identified.map(productRef),
    missing: missing.map(productRef),
    confirmedAt: visit.ruptureConfirmedAt,
    confirmed: visit.ruptures.map((r) => productRef(r.product)),
  }
}

/** O promotor confirma que a diferença (mix x fotos de depois) é ruptura. A lista precisa ser a mesma que ele viu. */
export async function confirmRupture(promotorId: string, visitId: string, productIds: string[]) {
  const settings = await getSettings(promotorId)
  const visit = await loadOwnVisit(promotorId, visitId)
  assertInProgress(visit)
  assertNotOnLunch(visit.workDay)
  assertPhotoStep(visit)
  const full = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
  const progress = visitProgress({ ...full, ruptureConfirmedAt: null }, settings)
  const before = progress.missing.filter((m) => m !== 'RUPTURA' && m !== 'ESTOQUE')
  if (progress.enforced && before.length > 0) {
    throw ruleViolation(`Antes de confirmar a ruptura, ${before.map((m) => stepMessages[m]).join(', ')}.`, 'SEQUENCIA', { missing: before })
  }

  const { missing } = await ruptureDiff(visitId)
  const expected = new Set(missing.map((p) => p.id))
  if (productIds.length !== expected.size || productIds.some((id) => !expected.has(id))) {
    throw conflict('A lista de produtos mudou. Atualize a tela e confirme de novo.', 'LISTA_MUDOU', { missing: missing.map(productRef) })
  }

  await prisma.$transaction(async (tx) => {
    await tx.visitRupture.deleteMany({ where: { visitId } })
    await tx.visitRupture.createMany({ data: missing.map((p) => ({ visitId, productId: p.id })) })
    await tx.visit.update({ where: { id: visitId }, data: { ruptureConfirmedAt: new Date() } })
  })
  return getVisitDetail(promotorId, visitId)
}
