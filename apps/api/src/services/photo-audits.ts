import { z } from 'zod'
import { AuditStatus, prisma } from '../db'
import { conflict } from '../lib/errors'

/** Aprovar ou reprovar uma foto: a reprovação exige justificativa (app do vendedor, do supervisor e painel). */
export const auditBodySchema = z
  .object({ status: z.enum(AuditStatus), justification: z.string().trim().max(1000).optional() })
  .refine((b) => b.status === 'APROVADA' || (b.justification?.length ?? 0) >= 5, {
    message: 'informe a justificativa da reprovação (mínimo 5 caracteres)',
    path: ['justification'],
  })

/**
 * Grava a auditoria da pessoa na foto (uma por pessoa e foto: refazer troca a anterior, do app ou do painel).
 * A auditoria de vendedor já conferida pelo supervisor fica travada.
 */
export async function saveAudit(photoId: string, auditorId: string, body: z.infer<typeof auditBodySchema>) {
  const key = { photoId_auditorId: { photoId, auditorId } }
  const existing = await prisma.photoAudit.findUnique({ where: key, include: { review: true } })
  if (existing?.review) throw conflict('Esta auditoria já foi conferida pelo supervisor e não pode mais ser alterada.', 'AUDITORIA_CONFERIDA')
  // A justificativa é da reprovação: aprovar de novo limpa a anterior
  const justification = body.justification || null
  await prisma.photoAudit.upsert({
    where: key,
    create: { photoId, auditorId, status: body.status, justification },
    update: { status: body.status, justification },
  })
}
