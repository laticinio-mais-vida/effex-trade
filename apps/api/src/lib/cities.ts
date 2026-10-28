import { z } from 'zod'

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const

export const zUf = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => (UFS as readonly string[]).includes(v), 'UF inválida')

/** Cidade como digitada, sem espaços sobrando. */
export const zCity = z
  .string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'informe a cidade').max(120))

/**
 * Chave de comparação da cidade: sem acento e em minúsculas ("Vitória" = "VITORIA").
 * A migração 20261028210000 faz o mesmo em SQL para os clientes que já existiam.
 */
export function cityKey(city: string) {
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Texto para comparar nomes na importação (sem acento, minúsculas, só letras e números). */
export function nameKey(name: string) {
  return cityKey(name).replace(/[^a-z0-9]+/g, ' ').trim()
}
