import { z } from 'zod'
import { HttpError } from './errors'

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {})
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
    const first = issues[0]
    const message = first ? `Dados inválidos: ${first.campo ? `${first.campo} - ` : ''}${first.mensagem}` : 'Dados inválidos'
    throw new HttpError(400, message, 'VALIDACAO', issues)
  }
  return result.data
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
export const zId = z.string().min(1).max(64)
export const zLat = z.number().min(-90).max(90)
export const zLng = z.number().min(-180).max(180)

export const zLocation = z.object({
  latitude: zLat,
  longitude: zLng,
  accuracy: z.number().nonnegative().optional(),
  mocked: z.boolean().optional(),
})
export type LocationInput = z.infer<typeof zLocation>

export const zIdParam = z.object({ id: zId })

/** Paginação padrão via querystring. */
export const zPage = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}

/** Lista via querystring: "a,b" ou a chave repetida (?x=a&x=b); um valor só continua valendo. */
export function zList<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item).max(500))
}

/** Querystring booleana ("true"/"false"). */
export const zQueryBool = z.enum(['true', 'false']).transform((v) => v === 'true')
