import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from './generated/prisma/client'
import { env } from './env'

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) })

export { Prisma }
export * from './generated/prisma/enums'
export type {
  AuditReview,
  Client,
  JustificationReason,
  LocationPing,
  PermissionRequest,
  Photo,
  PhotoAudit,
  Product,
  RouteItem,
  ScheduledVisit,
  Task,
  User,
  Visit,
  VisitSession,
  WorkDay,
} from './generated/prisma/client'

export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
