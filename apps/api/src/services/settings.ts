import { z } from 'zod'
import { prisma, PhotoType } from '../db'
import { badRequest } from '../lib/errors'

/**
 * Regras que delimitam o trabalho do promotor. Cada regra nova entra aqui:
 * no schema (validação), nos padrões e nos metadados (rótulo exibido no painel).
 *
 * As regras gerais valem para todos; regras de alcance "promotor" podem ter exceção por promotor
 * (tabela PromotorSetting), editada no painel escolhendo para quais promotores vale a mudança.
 */
const zWeekdays = z.array(z.number().int().min(0).max(6)).max(7)

export const settingsSchema = z.object({
  geofenceRadiusMeters: z.number().int().min(10).max(5000),
  blockMockedLocation: z.boolean(),
  maxLocationAccuracyMeters: z.number().int().min(0).max(5000),
  requireFacadePhotoOnCheckin: z.boolean(),
  enforceRouteOrderWeekdays: zWeekdays,
  requireCompleteRouteToEnd: z.boolean(),
  autoCloseForgottenVisit: z.boolean(),
  enforceVisitSequence: z.boolean(),
  afterPhotoWarningMinutes: z.number().int().min(0).max(60),
  lunchBreakEnabled: z.boolean(),
  lunchAlertMinutes: z.number().int().min(0).max(600),
  minVisitMinutes: z.number().int().min(0).max(600),
  requireGeofenceOnCheckout: z.boolean(),
  allowExtraVisits: z.boolean(),
  maxExtraVisitsPerDay: z.number().int().min(0).max(100),
  justificationMinLength: z.number().int().min(0).max(500),
  trackingIntervalMinutes: z.number().int().min(1).max(60),
  mapRefreshSeconds: z.number().int().min(30).max(3600),
  photoScoreMax: z.number().int().min(1).max(100),
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingKey = keyof Settings

export const defaultSettings: Settings = {
  geofenceRadiusMeters: 150,
  blockMockedLocation: true,
  maxLocationAccuracyMeters: 0,
  requireFacadePhotoOnCheckin: true,
  enforceRouteOrderWeekdays: [0, 1, 2, 3, 4, 5, 6],
  requireCompleteRouteToEnd: true,
  autoCloseForgottenVisit: true,
  enforceVisitSequence: true,
  afterPhotoWarningMinutes: 3,
  lunchBreakEnabled: true,
  lunchAlertMinutes: 120,
  minVisitMinutes: 0,
  requireGeofenceOnCheckout: true,
  allowExtraVisits: true,
  maxExtraVisitsPerDay: 10,
  justificationMinLength: 10,
  trackingIntervalMinutes: 3,
  mapRefreshSeconds: 180,
  photoScoreMax: 10,
}

type Meta = {
  label: string
  help: string
  group: string
  unit?: string
  /** promotor = pode ter exceção por promotor; geral = vale para o painel inteiro */
  scope: 'promotor' | 'geral'
  options?: { value: string | number; label: string }[]
}

export const photoTypeLabels: Record<PhotoType, string> = {
  FACHADA: 'Fachada',
  ANTES: 'Antes',
  DEPOIS: 'Depois',
  RUPTURA: 'Ruptura',
  VENCIMENTO: 'Vencimento',
  ATIVIDADE_EXTRA: 'Atividade extra',
}

const weekdayOptions = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]

export const settingsMeta: Record<SettingKey, Meta> = {
  geofenceRadiusMeters: {
    scope: 'promotor',
    group: 'Check-in',
    label: 'Raio da cerca eletrônica',
    unit: 'm',
    help: 'Distância máxima entre o promotor e o cliente para permitir o check-in. Pode ser sobrescrito por cliente.',
  },
  blockMockedLocation: { scope: 'promotor', group: 'Check-in', label: 'Bloquear GPS falso', help: 'Recusa check-in quando o aparelho informa localização simulada (Android).' },
  maxLocationAccuracyMeters: {
    scope: 'promotor',
    group: 'Check-in',
    label: 'Precisão mínima do GPS',
    unit: 'm',
    help: 'Recusa o check-in se a precisão do GPS for pior que este valor. 0 desativa.',
  },
  requireFacadePhotoOnCheckin: {
    scope: 'promotor',
    group: 'Check-in',
    label: 'Foto da fachada na abertura',
    help: 'O atendimento só abre (ou reabre) com a foto da fachada da loja, tirada na hora do check-in.',
  },
  requireCompleteRouteToEnd: {
    scope: 'promotor',
    group: 'Roteiro',
    label: 'Encerrar só com o roteiro completo',
    help: 'O promotor só encerra o roteiro com todos os clientes atendidos. Para encerrar antes, precisa justificar cada cliente sem atendimento. O roteiro começa sozinho no primeiro check-in.',
  },
  autoCloseForgottenVisit: {
    scope: 'promotor',
    group: 'Roteiro',
    label: 'Encerrar atendimento esquecido',
    help: 'Se o promotor esquecer o check-out, ao abrir o próximo atendimento o anterior é encerrado sozinho no horário da última foto tirada nele (sem exigir a cerca). O deslocamento passa a contar dessa foto até a nova abertura.',
  },
  enforceRouteOrderWeekdays: {
    scope: 'promotor',
    group: 'Roteiro',
    label: 'Obrigar ordem do roteiro',
    help: 'Nos dias marcados, o promotor só faz check-in no próximo cliente da sequência. Alterar a ordem, atender um cliente fora dela ou ficar o dia inteiro sem ordem exige liberação do supervisor. Clientes extras ficam fora da ordem.',
    options: weekdayOptions,
  },
  allowExtraVisits: {
    scope: 'promotor',
    group: 'Roteiro',
    label: 'Permitir incluir clientes extras',
    help: 'O promotor pode acrescentar ao dia clientes que não estão no roteiro. Para voltar a um cliente já atendido, ele reabre o atendimento.',
  },
  maxExtraVisitsPerDay: { scope: 'promotor', group: 'Roteiro', label: 'Máximo de clientes extras por dia', help: 'Limite de visitas extras que o promotor pode incluir num mesmo dia.' },
  lunchBreakEnabled: {
    scope: 'promotor',
    group: 'Roteiro',
    label: 'Bloqueio de almoço',
    help: 'O promotor abre o almoço no app; durante o almoço nenhuma atividade pode ser feita. A volta do almoço é a abertura do próximo cliente (ou a justificativa dele, feita na cerca dele ou do cliente seguinte). O almoço sai do deslocamento e das horas trabalhadas.',
  },
  lunchAlertMinutes: {
    scope: 'promotor',
    group: 'Roteiro',
    label: 'Alertar o supervisor quando o almoço passar de',
    unit: 'min',
    help: 'O supervisor recebe um alerta no app e no painel quando o almoço do promotor passar deste tempo. Não há tempo mínimo nem horário fixo de almoço. 0 desativa.',
  },
  enforceVisitSequence: {
    scope: 'promotor',
    group: 'Atendimento',
    label: 'Sequência obrigatória do atendimento',
    help: 'Nesta ordem: foto de antes, fotos de depois identificando os produtos e confirmação de que os produtos do mix do cliente que não aparecem nas fotos de depois são ruptura. Tudo é exigido para o check-out (salvo liberação "sem fotos" do supervisor).',
  },
  minVisitMinutes: { scope: 'promotor', group: 'Atendimento', label: 'Tempo mínimo no cliente', unit: 'min', help: 'Bloqueia o check-out antes deste tempo. 0 desativa.' },
  afterPhotoWarningMinutes: {
    scope: 'promotor',
    group: 'Atendimento',
    label: 'Aviso de foto de depois muito rápida',
    unit: 'min',
    help: 'Se a foto de depois for tirada antes deste tempo desde a foto de antes, o app avisa: "verifique se essa foto não é de antes, está lançando no depois". Se o promotor confirmar, a foto fica marcada para o painel. 0 desativa.',
  },
  requireGeofenceOnCheckout: {
    scope: 'promotor',
    group: 'Atendimento',
    label: 'Exigir cerca no check-out',
    help: 'O check-out também precisa ser feito dentro da cerca eletrônica. Não vale para o encerramento automático de atendimento esquecido.',
  },
  justificationMinLength: {
    scope: 'promotor',
    group: 'Atendimento',
    label: 'Tamanho mínimo da justificativa',
    unit: 'caracteres',
    help: 'Quantidade mínima de caracteres no texto da justificativa de não atendimento.',
  },
  trackingIntervalMinutes: { scope: 'promotor', group: 'Rastreamento', label: 'Intervalo de envio da localização', unit: 'min', help: 'De quanto em quanto tempo o app envia a posição do promotor.' },
  mapRefreshSeconds: { scope: 'geral', group: 'Rastreamento', label: 'Atualização do mapa no painel', unit: 's', help: 'Intervalo de atualização automática do mapa de promotores.' },
  photoScoreMax: { scope: 'geral', group: 'Avaliação', label: 'Nota máxima das fotos', help: 'Escala da nota atribuída às fotos no painel (de 0 até este valor).' },
}

const CACHE_MS = 15_000
let globalCache: { value: Settings; at: number } | null = null
const promotorCache = new Map<string, { value: Partial<Settings>; at: number }>()

function applyRows(base: Settings, rows: { key: string; value: unknown }[], onlyPromotorScope = false) {
  const value: Settings = { ...base }
  for (const row of rows) {
    const key = row.key as SettingKey
    const field = settingsSchema.shape[key]
    if (!field || (onlyPromotorScope && settingsMeta[key].scope !== 'promotor')) continue
    const parsed = field.safeParse(row.value)
    if (parsed.success) (value as Record<string, unknown>)[key] = parsed.data
  }
  return value
}

async function globalSettings() {
  if (globalCache && Date.now() - globalCache.at < CACHE_MS) return globalCache.value
  const value = applyRows(defaultSettings, await prisma.setting.findMany())
  globalCache = { value, at: Date.now() }
  return value
}

async function promotorOverrides(promotorId: string) {
  const cached = promotorCache.get(promotorId)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const rows = await prisma.promotorSetting.findMany({ where: { promotorId } })
  const value = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>
  promotorCache.set(promotorId, { value, at: Date.now() })
  return value
}

/** Regras gerais ou, com promotorId, as regras efetivas daquele promotor (gerais + exceções dele). */
export async function getSettings(promotorId?: string): Promise<Settings> {
  const base = await globalSettings()
  if (!promotorId) return base
  const overrides = await promotorOverrides(promotorId)
  return applyRows(
    base,
    Object.entries(overrides).map(([key, value]) => ({ key, value })),
    true,
  )
}

/** A ordem do roteiro vale no dia da semana da data (AAAA-MM-DD)? */
export function routeOrderEnforced(settings: Settings, date: string) {
  return settings.enforceRouteOrderWeekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())
}

function parseValues(input: unknown) {
  const parsed = settingsSchema.partial().strict().safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw badRequest(`Regra inválida: ${issue?.path.join('.')} - ${issue?.message}`, 'VALIDACAO', parsed.error.issues)
  }
  return parsed.data
}

/** Altera as regras gerais (valem para todos os promotores sem exceção). */
export async function updateSettings(input: unknown) {
  const values = parseValues(input)
  await prisma.$transaction(
    Object.entries(values).map(([key, value]) => prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } })),
  )
  globalCache = null
  return getSettings()
}

/** Grava as regras alteradas como exceção para os promotores escolhidos. */
export async function updatePromotorSettings(promotorIds: string[], input: unknown) {
  const values = parseValues(input)
  const global = Object.keys(values).filter((k) => settingsMeta[k as SettingKey].scope !== 'promotor')
  if (global.length) throw badRequest(`Estas regras valem para o painel inteiro e não têm exceção por promotor: ${global.map((k) => settingsMeta[k as SettingKey].label).join(', ')}.`)
  const promotores = await prisma.user.count({ where: { id: { in: promotorIds }, role: 'PROMOTOR' } })
  if (promotores !== new Set(promotorIds).size) throw badRequest('Um ou mais usuários escolhidos não são promotores.')
  await prisma.$transaction(
    promotorIds.flatMap((promotorId) =>
      Object.entries(values).map(([key, value]) =>
        prisma.promotorSetting.upsert({
          where: { promotorId_key: { promotorId, key } },
          create: { promotorId, key, value: value as never },
          update: { value: value as never },
        }),
      ),
    ),
  )
  promotorIds.forEach((id) => promotorCache.delete(id))
}

/** Remove exceções (o promotor volta à regra geral). Sem keys, remove todas as exceções dele. */
export async function clearPromotorSettings(promotorIds: string[], keys?: string[]) {
  await prisma.promotorSetting.deleteMany({ where: { promotorId: { in: promotorIds }, ...(keys?.length ? { key: { in: keys } } : {}) } })
  promotorIds.forEach((id) => promotorCache.delete(id))
}

/** Exceções gravadas, por promotor. */
export async function listPromotorOverrides() {
  const rows = await prisma.promotorSetting.findMany({ include: { promotor: { select: { id: true, name: true } } }, orderBy: [{ promotor: { name: 'asc' } }, { key: 'asc' }] })
  const byPromotor = new Map<string, { promotor: { id: string; name: string }; values: Record<string, unknown> }>()
  for (const r of rows) {
    if (!(r.key in settingsMeta)) continue
    const entry = byPromotor.get(r.promotorId) ?? { promotor: r.promotor, values: {} }
    entry.values[r.key] = r.value
    byPromotor.set(r.promotorId, entry)
  }
  return [...byPromotor.values()]
}
