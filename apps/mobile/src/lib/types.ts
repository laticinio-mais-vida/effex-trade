// Tipos das respostas da API (apps/api/src/services/serializers.ts e rotas)

export type Role = 'ADMIN' | 'SUPERVISOR' | 'VENDEDOR' | 'PROMOTOR'
export type VisitStatus = 'PENDENTE' | 'EM_ATENDIMENTO' | 'CONCLUIDA' | 'JUSTIFICADA' | 'CANCELADA'
export type VisitOrigin = 'ROTEIRO' | 'EXTRA' | 'SUBSTITUICAO' | 'PONTUAL'
/** Etapas do atendimento: padrão (fotos antes, depois e ruptura), atividades extras e contagem de estoque. */
export type VisitModule = 'FOTOS' | 'ATIVIDADES' | 'ESTOQUE'
export type TaskRecurrence = 'TODA_VISITA' | 'PONTUAL' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL'
export type PhotoType = 'FACHADA' | 'ANTES' | 'DEPOIS' | 'RUPTURA' | 'VENCIMENTO' | 'ATIVIDADE_EXTRA'
export type AuditStatus = 'APROVADA' | 'REPROVADA'
export type ReviewVerdict = 'CORRETA' | 'INCORRETA'
export type RequestStatus = 'PENDENTE' | 'APROVADA' | 'NEGADA' | 'CANCELADA'

export interface User {
  id: string
  name: string
  login: string
  email: string | null
  phone: string | null
  role: Role
  active: boolean
  supervisorId: string | null
  supervisor?: { id: string; name: string } | null
}

/** Clientes que chegam ao app sempre têm localização (a API não deixa entrar em roteiro sem ela). */
export interface Client {
  id: string
  /** Nome fantasia */
  name: string
  /** Razão social */
  legalName: string | null
  city: string | null
  state: string | null
  latitude: number
  longitude: number
}

export interface Product {
  id: string
  code: string
  name: string
  brand: string | null
}

/** Produto na lista de identificação: só os do mix do cliente (todos inMix); sem mix cadastrado vem o catálogo inteiro. */
export interface ProductOption extends Product {
  category: string | null
  inMix: boolean
}

export interface Photo {
  id: string
  visitId: string
  type: PhotoType
  taskId: string | null
  url: string
  takenAt: string
  latitude: number | null
  longitude: number | null
  notes: string | null
  meta: Record<string, unknown> | null
  /** Produtos identificados (fotos de depois). */
  products?: Product[]
}

export type VisitStep = 'ANTES' | 'DEPOIS' | 'PRODUTOS' | 'RUPTURA' | 'ESTOQUE' | 'CHECKOUT'

/** Sequência obrigatória do atendimento: fachada -> antes -> depois com produtos -> ruptura -> check-out. */
export interface VisitProgress {
  /** A sequência de fotos vale nesta visita (estrutura com a etapa padrão, regra ligada e fotos não dispensadas). */
  enforced: boolean
  stockConfirmed?: boolean
  facade: boolean
  before: number
  after: number
  afterWithoutProducts: number
  ruptureConfirmed: boolean
  missing: VisitStep[]
  next: VisitStep
}

export interface RuptureInfo {
  mixSize: number
  hasMix: boolean
  identified: Product[]
  missing: Product[]
  confirmedAt: string | null
  confirmed: Product[]
}

/** Atividade extra. Ao reabrir o cliente, as atividades já feitas continuam feitas. */
export interface VisitTask {
  id: string
  title: string
  description: string | null
  recurrence?: TaskRecurrence
  requiresPhoto: boolean
  /** Obrigatória: o check-out só sai com ela concluída. */
  required: boolean
  done: boolean
  completedAt: string | null
  notes: string | null
}

/** Uma abertura do atendimento. O cliente reaberto no dia tem mais de uma; o tempo no cliente é a soma. */
export interface VisitSession {
  checkinAt: string
  checkoutAt: string | null
  autoClosed: boolean
}

export interface Visit {
  id: string
  date: string
  position: number
  origin: VisitOrigin
  status: VisitStatus
  /** Estrutura do atendimento. */
  modules?: VisitModule[]
  /** Promotor confirmou a contagem de estoque (etapa feita fora do app). */
  stockConfirmedAt?: string | null
  client: Client
  checkinAt: string | null
  checkinDistance: number | null
  checkoutAt: string | null
  geofenceWaived: boolean
  photosWaived: boolean
  /** Liberado pelo supervisor da ordem do roteiro: pode ser atendido a qualquer momento. */
  routeOrderWaived?: boolean
  /** Encerrado pelo sistema ao abrir o próximo atendimento (saída = última foto). */
  autoClosed?: boolean
  ruptureConfirmedAt?: string | null
  ruptures?: Product[]
  progress?: VisitProgress
  sessions?: VisitSession[]
  justification: { reasonId: string | null; reason: string | null; text: string | null; at: string } | null
  notes: string | null
  replacesVisitId: string | null
  photos?: Photo[]
  requests?: { id: string; type: string; status: RequestStatus; createdAt: string; decisionNote: string | null }[]
  tasks?: VisitTask[]
  /** Incluída pelo supervisor como visita pontual, com o recado dele. */
  scheduled?: { id: string; note: string | null; createdBy: string }
}

/** Resposta do check-in ou da reabertura: a visita aberta e os atendimentos esquecidos que foram encerrados. */
export interface CheckinResult extends Visit {
  /** true quando foi uma reabertura de cliente já atendido. */
  reopened?: boolean
  autoClosedVisits?: { visitId: string; clientName: string; checkoutAt: string }[]
  /** Preenchido quando esta abertura foi a volta do almoço. */
  lunchEndedAt?: string | null
}

export interface DayRules {
  geofenceRadiusMeters: number
  enforceRouteOrder: boolean
  requireFacadePhotoOnCheckin: boolean
  enforceVisitSequence: boolean
  /** Aviso se a foto de depois sair antes deste tempo desde a foto de antes (0 = desligado). */
  afterPhotoWarningMinutes: number
  lunchBreakEnabled: boolean
  /** Almoço acima deste tempo (min) gera alerta ao supervisor (0 = desligado). Não há tempo mínimo. */
  lunchAlertMinutes?: number
  requireCompleteRouteToEnd: boolean
  autoCloseForgottenVisit: boolean
  requireGeofenceOnCheckout: boolean
  blockMockedLocation: boolean
  maxLocationAccuracyMeters: number
  allowExtraVisits: boolean
  maxExtraVisitsPerDay: number
  minVisitMinutes: number
  justificationMinLength: number
  trackingIntervalMinutes: number
}

export interface Day {
  date: string
  isToday: boolean
  /**
   * startedAt = ponto de início (abertura do primeiro atendimento); endedAt = ponto de fim (última atividade);
   * closedAt = quando o roteiro foi encerrado. Almoço: da abertura até a volta (abertura ou justificativa do próximo cliente).
   */
  workDay: {
    id: string
    startedAt: string | null
    endedAt: string | null
    closedAt?: string | null
    lunchStartedAt?: string | null
    lunchEndedAt?: string | null
    /** Supervisor liberou o dia inteiro da ordem do roteiro (rules.enforceRouteOrder já vem desligado). */
    routeOrderWaived?: boolean
  } | null
  rules: DayRules
  nextVisitId: string | null
  inProgressVisitId: string | null
  visits: Visit[]
  reasons: { id: string; label: string }[]
}

export interface PermissionRequest {
  id: string
  type: string
  typeLabel: string
  status: RequestStatus
  date: string
  promotor: { id: string; name: string }
  visit: { id: string; position: number; status: VisitStatus; client: { id: string; name: string; city: string | null } } | null
  payload: Record<string, any> | null
  reason: string | null
  createdBy: { id: string; name: string; role: Role }
  createdAt: string
  decidedBy: { id: string; name: string } | null
  decidedAt: string | null
  decisionNote: string | null
}

export interface PermissionTypeDef {
  type: string
  label: string
  description: string
  needsVisit: boolean
}

export interface Audit {
  id: string
  status: AuditStatus
  justification: string | null
  createdAt: string
  auditor: { id: string; name: string; role: Role }
  review: { verdict: ReviewVerdict; comment: string | null; supervisor: { id: string; name: string }; createdAt: string } | null
}

export interface AuditPhoto extends Photo {
  visit: { id: string; date: string; checkinAt: string | null; checkoutAt: string | null }
  client: { id: string; name: string; city: string | null }
  promotor: { id: string; name: string }
  myAudit: Audit | null
  otherAudits: Audit[]
}

export interface VendorAudit {
  id: string
  status: AuditStatus
  justification: string | null
  createdAt: string
  vendedor: { id: string; name: string }
  review: { verdict: ReviewVerdict; comment: string | null; supervisor: { id: string; name: string }; createdAt: string } | null
  photo: Photo
  visit: { id: string; date: string }
  client: { id: string; name: string; city: string | null }
  promotor: { id: string; name: string }
}

export interface Paged<T> {
  total: number
  page: number
  pageSize: number
  items: T[]
}

/** Alerta ao supervisor (ex.: ALMOCO_LONGO = almoço acima do limite). "Aberto" = ainda sem "ciente". */
export interface SupervisorAlert {
  id: string
  type: string
  message: string
  promotor: { id: string; name: string; phone: string | null }
  createdAt: string
  resolvedAt: string | null
  acknowledgedAt: string | null
  acknowledgedBy: { id: string; name: string } | null
  lunchStartedAt: string | null
  lunchEndedAt: string | null
}

export interface SupervisorSummary {
  pendingRequests: number
  pendingVendorAudits: number
  /** Alertas sem "ciente" */
  openAlerts?: number
}

export interface Team {
  promotores: { id: string; name: string; today: { total: number; done: number; justified: number; pending: number; inProgress: number } }[]
  vendedores: { id: string; name: string; pendingReviews: number }[]
}

export interface SupervisorDay {
  promotor: { id: string; name: string }
  date: string
  workDay: { startedAt: string | null; endedAt: string | null; closedAt?: string | null; routeOrderWaived?: boolean } | null
  /** A ordem do roteiro é obrigatória neste dia pelas regras do promotor (sem contar liberações). */
  routeOrderEnforced?: boolean
  visits: Visit[]
  /** Visitas pontuais de hoje em diante (as de hoje também estão em visits). */
  scheduled?: ScheduledVisit[]
  /** Até quantos dias à frente dá para agendar uma visita pontual. */
  scheduleDaysAhead?: number
}

/** Visita pontual: cliente incluído pelo supervisor num único dia do promotor, fora do roteiro fixo. */
export interface ScheduledVisit {
  id: string
  date: string
  note: string | null
  modules: VisitModule[]
  /** Atividade escrita pelo supervisor para esta visita. */
  activity: { id: string; title: string; requiresPhoto: boolean } | null
  client: Client
  createdBy: { id: string; name: string }
  createdAt: string
  /** Visita do dia, quando o dia já foi gerado (hoje). */
  visit: { id: string; status: VisitStatus } | null
}
