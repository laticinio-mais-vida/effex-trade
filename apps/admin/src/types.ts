export type Role = 'ADMIN' | 'SUPERVISOR' | 'VENDEDOR' | 'PROMOTOR'
export type VisitStatus = 'PENDENTE' | 'EM_ATENDIMENTO' | 'CONCLUIDA' | 'JUSTIFICADA' | 'CANCELADA'
export type VisitOrigin = 'ROTEIRO' | 'EXTRA' | 'SUBSTITUICAO' | 'PONTUAL'
/** Etapas do atendimento: padrão (fotos antes, depois e ruptura), atividades extras e contagem de estoque */
export type VisitModule = 'FOTOS' | 'ATIVIDADES' | 'ESTOQUE'
export type TaskRecurrence = 'TODA_VISITA' | 'PONTUAL' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL'
export type PhotoType = 'FACHADA' | 'ANTES' | 'DEPOIS' | 'RUPTURA' | 'VENCIMENTO' | 'ATIVIDADE_EXTRA'
export type RequestStatus = 'PENDENTE' | 'APROVADA' | 'NEGADA' | 'CANCELADA'

export type Ref = { id: string; name: string }

export type ProductRef = { id: string; code: string; name: string; brand: string | null }
export type Product = ProductRef & { category: string | null; active: boolean; mixClients: number }

/** Cidade atendida pelo usuário; sem cidade = a UF inteira. */
export type Area = { state: string; city: string | null }

export type User = {
  id: string
  name: string
  login: string
  email: string | null
  phone: string | null
  role: Role
  active: boolean
  supervisorId: string | null
  supervisor?: Ref | null
  areas: Area[]
  createdAt: string
}

export type Client = {
  id: string
  /** Nome fantasia */
  name: string
  /** Razão social */
  legalName: string | null
  city: string | null
  state: string | null
  /** Sem localização o cliente não entra em roteiro */
  latitude: number | null
  longitude: number | null
  active: boolean
}
export type LocatedClient = Client & { latitude: number; longitude: number }

/** Cidade com clientes cadastrados */
export type ClientCity = { state: string; city: string; clients: number }

export type Paged<T> = { total: number; page: number; pageSize: number; items: T[] }

export type Lookups = {
  promotores: (Ref & { supervisorId: string | null })[]
  vendedores: (Ref & { supervisorId: string | null })[]
  supervisores: Ref[]
  reasons: { id: string; label: string; active: boolean; position: number }[]
  permissionTypes: { type: string; label: string; description: string; needsVisit: boolean }[]
  photoTypes: { value: PhotoType; label: string }[]
}

export type AlertItem = {
  id: string
  type: string
  message: string
  promotor: Ref & { phone: string | null }
  createdAt: string
  resolvedAt: string | null
  acknowledgedAt: string | null
  acknowledgedBy: Ref | null
  lunchStartedAt: string | null
  lunchEndedAt: string | null
}

export type Dashboard = {
  date: string
  promotores: number
  online: number
  visits: { total: number; done: number; justified: number; pending: number; inProgress: number }
  pendingRequests: number
  photosToday: number
  photosUnreviewed: number
  alerts: AlertItem[]
}

export type Stats = { total: number; done: number; justified: number; pending: number; inProgress: number }

export type MapData = {
  date: string
  generatedAt: string
  refreshSeconds: number
  promotores: (Ref & {
    phone: string | null
    workStart: string | null
    workEnd: string | null
    lunch: { start: string; end: string | null; overdue: boolean } | null
    lastPing: { latitude: number; longitude: number; accuracy: number | null; battery: number | null; mocked: boolean; recordedAt: string } | null
    currentVisit: { id: string; clientName: string; since: string } | null
    stats: Stats
  })[]
  visits: {
    id: string
    promotorId: string
    position: number
    origin: VisitOrigin
    status: VisitStatus
    autoClosed: boolean
    checkinAt: string | null
    checkoutAt: string | null
    justification: { reason: string | null; text: string | null } | null
    client: { id: string; name: string; city: string | null; state: string | null; latitude: number | null; longitude: number | null }
  }[]
  trail: { latitude: number; longitude: number; recordedAt: string }[]
}

export type ReportRow = {
  id: string
  date: string
  promotor: Ref
  position: number
  origin: VisitOrigin
  status: VisitStatus
  modules: VisitModule[]
  stockConfirmedAt: string | null
  client: { id: string; name: string; city: string | null }
  checkinAt: string | null
  checkoutAt: string | null
  durationMin: number | null
  travelMin: number | null
  travelKm: number | null
  afterLunch: boolean
  checkinDistance: number | null
  geofenceWaived: boolean
  photosWaived: boolean
  autoClosed: boolean
  photoCount: number
  ruptures: { id: string; code: string; name: string }[]
  sessions: VisitSessionInfo[]
  justification: { reason: string | null; text: string | null; at: string } | null
  approvedRequests: string[]
}

export type ReportSummary = {
  promotor: Ref
  days: number
  total: number
  planned: number
  extras: number
  done: number
  justified: number
  notDone: number
  inProgress: number
  executionRate: number
  totalClientMin: number
  avgClientMin: number | null
  totalTravelMin: number
  avgTravelMin: number | null
  totalTravelKm: number | null
  geofenceWaivers: number
  photoWaivers: number
  autoClosed: number
  ruptures: number
  justificationsByReason: Record<string, number>
}

export type ReportDay = {
  date: string
  promotor: Ref
  workStart: string | null
  workEnd: string | null
  closedAt: string | null
  lunchStart: string | null
  lunchEnd: string | null
  lunchMin: number | null
  lunchOverdue: boolean
  routeOrderWaived: boolean
  workedMin: number | null
  total: number
  done: number
  justified: number
  notDone: number
  clientMin: number
  travelMin: number
  travelKm: number | null
}

/** De onde vêm as distâncias: servidor de rotas (ruas), linha reta (sem servidor ou trecho sem rota) ou os dois. */
export type DistanceMode = 'ruas' | 'linha_reta' | 'misto'

export type Report = { from: string; to: string; travelKmSource: DistanceMode | null; summary: ReportSummary[]; days: ReportDay[]; rows: ReportRow[] }

export type PhotoItem = {
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
  score: number | null
  reviewNotes: string | null
  reviewedAt: string | null
  products?: ProductRef[]
  visit: { id: string; date: string; status: VisitStatus }
  client: { id: string; name: string; city: string | null }
  promotor: Ref
  task: { id: string; title: string } | null
  reviewedBy: Ref | null
  audits: {
    id: string
    status: 'APROVADA' | 'REPROVADA'
    justification: string | null
    auditor: Ref & { role: Role }
    createdAt: string
    review: { verdict: 'CORRETA' | 'INCORRETA'; comment: string | null } | null
  }[]
}

export type PermissionRequest = {
  id: string
  type: string
  typeLabel: string
  status: RequestStatus
  date: string
  promotor: Ref
  visit: { id: string; position: number; status: VisitStatus; client: { id: string; name: string; city: string | null } } | null
  payload: Record<string, unknown> | null
  reason: string | null
  createdBy: Ref & { role: Role }
  createdAt: string
  decidedBy: Ref | null
  decidedAt: string | null
  decisionNote: string | null
}

export type AuditErrors = {
  vendedor: { id: string; name: string; supervisor: string | null }
  from: string
  to: string
  stats: { audited: number; reviewed: number; incorrect: number; accuracy: number | null }
  items: {
    auditId: string
    vendedorStatus: 'APROVADA' | 'REPROVADA'
    vendedorJustification: string | null
    auditedAt: string
    correctStatus: 'APROVADA' | 'REPROVADA'
    supervisorComment: string | null
    supervisor: string
    reviewedAt: string
    photo: { id: string; type: PhotoType; url: string; takenAt: string; notes: string | null }
    visitDate: string
    client: { name: string; city: string | null }
    promotor: string
  }[]
}

export type Task = {
  id: string
  title: string
  description: string | null
  clientId: string | null
  promotorId: string | null
  startDate: string
  /** Sem data de fim: vale até ser desativada */
  endDate: string | null
  recurrence: TaskRecurrence
  requiresPhoto: boolean
  required: boolean
  active: boolean
  /** Escrita pelo supervisor numa visita pontual */
  scheduledVisitId: string | null
  client: { id: string; name: string; city: string | null } | null
  promotor: Ref | null
  createdBy: Ref
  photoCount: number
  completionCount: number
}

export type SettingMeta = {
  label: string
  help: string
  group: string
  unit?: string
  scope: 'promotor' | 'geral'
  options?: { value: string | number; label: string }[]
}
export type PromotorOverride = { promotor: Ref; values: Record<string, unknown> }
export type SettingsResponse = {
  values: Record<string, unknown>
  defaults: Record<string, unknown>
  meta: Record<string, SettingMeta>
  overrides: PromotorOverride[]
  /** vendedores atendidos por cada promotor (pelos clientes do roteiro fixo) */
  promotorSellers: Record<string, string[]>
}

export type VisitSessionInfo = { checkinAt: string; checkoutAt: string | null; autoClosed: boolean }

export type FrequencyType = 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'DIAS' | 'SEMANAS'
/** Frequência do cliente no roteiro. interval: DIAS = de X em X dias; SEMANAS = semanas puladas. startDate = primeira visita. */
export type Frequency = { type: FrequencyType; interval: number | null; startDate: string | null }
/** Cliente do roteiro (sempre com localização). outsideArea: fora das cidades do promotor (precisa sair do roteiro). */
export type RouteClient = LocatedClient & { frequency: Frequency; modules: VisitModule[]; outsideArea?: boolean }
export type RouteDay = { weekday: number; clients: RouteClient[] }
