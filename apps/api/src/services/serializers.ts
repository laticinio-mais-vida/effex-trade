import type { Client, JustificationReason, PermissionRequest, Photo, Product, User, Visit, VisitSession } from '../db'
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

export function serializeClient(client: Client, defaultRadius?: number) {
  return {
    id: client.id,
    code: client.code,
    name: client.name,
    tradeName: client.tradeName,
    document: client.document,
    address: client.address,
    city: client.city,
    state: client.state,
    latitude: client.latitude,
    longitude: client.longitude,
    geofenceRadius: client.geofenceRadius ?? defaultRadius ?? null,
    sellerId: client.sellerId,
    active: client.active,
  }
}

export function serializeUser(user: Pick<User, 'id' | 'name' | 'login' | 'email' | 'phone' | 'role' | 'active' | 'supervisorId' | 'createdAt'>) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
    supervisorId: user.supervisorId,
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
}

export function serializeVisit(visit: VisitWithRelations, defaultRadius?: number) {
  return {
    id: visit.id,
    date: fromDbDate(visit.date),
    position: visit.position,
    origin: visit.origin,
    status: visit.status,
    client: serializeClient(visit.client, defaultRadius),
    checkinAt: visit.checkinAt,
    checkinDistance: visit.checkinDistance,
    checkoutAt: visit.checkoutAt,
    geofenceWaived: visit.geofenceWaived,
    photosWaived: visit.photosWaived,
    autoClosed: visit.autoClosed,
    ruptureConfirmedAt: visit.ruptureConfirmedAt,
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
  }
}
