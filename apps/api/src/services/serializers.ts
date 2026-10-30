import type { Client, JustificationReason, PermissionRequest, Photo, Product, ScheduledVisit, User, Visit, VisitSession } from '../db'
import { fromDbDate } from '../lib/dates'
import { publicUrl } from './storage'

export const productRef = (p: Product) => ({ id: p.id, code: p.code, name: p.name, brand: p.brand })

export function serializePhoto(photo: Photo & { products?: { product: Product }[] }) {
  return {
    id: photo.id,
    visitId: photo.visitId,
    type: photo.type,
    taskId: photo.taskId,
    url: publicUrl(photo.path),
    takenAt: photo.takenAt,
    latitude: photo.latitude,
    longitude: photo.longitude,
    notes: photo.notes,
    meta: photo.meta,
    score: photo.score,
    reviewNotes: photo.reviewNotes,
    reviewedAt: photo.reviewedAt,
    products: photo.products?.map((pp) => productRef(pp.product)),
  }
}

export function serializeClient(client: Client) {
  return {
    id: client.id,
    /** Nome fantasia */
    name: client.name,
    /** Razão social */
    legalName: client.legalName,
    city: client.city,
    state: client.state,
    latitude: client.latitude,
    longitude: client.longitude,
    /** ERP: a sincronização atualiza; PAINEL: editada no painel, a sincronização não muda */
    locationSource: client.locationSource,
    active: client.active,
    /** Código no ERP: com ele, nome, razão social, cidade, UF e situação vêm da sincronização */
    erpId: client.erpId,
  }
}

export function serializeUser(
  user: Pick<User, 'id' | 'name' | 'login' | 'email' | 'phone' | 'role' | 'active' | 'supervisorId' | 'createdAt'> & { areas?: { state: string; city: string | null }[] },
) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
    supervisorId: user.supervisorId,
    /** Cidades atendidas (sem cidade = a UF inteira) */
    areas: user.areas?.map((a) => ({ state: a.state, city: a.city })),
    createdAt: user.createdAt,
  }
}

type VisitWithRelations = Visit & {
  client: Client
  photos?: (Photo & { products?: { product: Product }[] })[]
  ruptures?: { product: Product }[]
  sessions?: VisitSession[]
  justificationReason?: JustificationReason | null
  requests?: PermissionRequest[]
  scheduledVisit?: (ScheduledVisit & { createdBy: { name: string } }) | null
}

export function serializeVisit(visit: VisitWithRelations) {
  return {
    id: visit.id,
    date: fromDbDate(visit.date),
    position: visit.position,
    origin: visit.origin,
    status: visit.status,
    /** Estrutura do atendimento (etapas) */
    modules: visit.modules,
    client: serializeClient(visit.client),
    checkinAt: visit.checkinAt,
    checkinDistance: visit.checkinDistance,
    checkoutAt: visit.checkoutAt,
    geofenceWaived: visit.geofenceWaived,
    photosWaived: visit.photosWaived,
    routeOrderWaived: visit.routeOrderWaived,
    autoClosed: visit.autoClosed,
    ruptureConfirmedAt: visit.ruptureConfirmedAt,
    stockConfirmedAt: visit.stockConfirmedAt,
    ruptures: visit.ruptures?.map((r) => productRef(r.product)),
    /** Aberturas do atendimento (mais de uma quando o cliente foi reaberto no dia) */
    sessions: visit.sessions?.map((x) => ({ checkinAt: x.checkinAt, checkoutAt: x.checkoutAt, autoClosed: x.autoClosed })),
    justification: visit.justifiedAt
      ? { reasonId: visit.justificationReasonId, reason: visit.justificationReason?.label ?? null, text: visit.justificationText, at: visit.justifiedAt }
      : null,
    notes: visit.notes,
    replacesVisitId: visit.replacesVisitId,
    photos: visit.photos?.map(serializePhoto),
    requests: visit.requests?.map((r) => ({ id: r.id, type: r.type, status: r.status, createdAt: r.createdAt, decisionNote: r.decisionNote })),
    /** Incluída pelo supervisor como visita pontual (com o recado dele ao promotor) */
    scheduled: visit.scheduledVisit ? { id: visit.scheduledVisit.id, note: visit.scheduledVisit.note, createdBy: visit.scheduledVisit.createdBy.name } : undefined,
  }
}
