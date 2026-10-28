import { z } from 'zod'
import { VisitModule } from '../db'

/**
 * Estrutura do atendimento: combinação livre das etapas padrão (fotos antes, depois e ruptura),
 * atividades extras e contagem de estoque. Todo cliente novo no roteiro entra com padrão + atividades extras.
 */
export const DEFAULT_MODULES: VisitModule[] = ['FOTOS', 'ATIVIDADES']
const MODULE_ORDER: VisitModule[] = ['FOTOS', 'ATIVIDADES', 'ESTOQUE']

/** Junta as etapas de mais de uma origem (ex.: o cliente cai duas vezes no dia), na ordem canônica e sem repetir. */
export const mergeModules = (...lists: VisitModule[][]) => MODULE_ORDER.filter((m) => lists.some((l) => l.includes(m)))

/** Estrutura só com atividades extras: sem atividade por fazer, o cliente não entra no dia. */
export const onlyActivities = (modules: VisitModule[]) => modules.length > 0 && modules.every((m) => m === 'ATIVIDADES')

export const zModules = z
  .array(z.enum(VisitModule))
  .min(1, 'escolha ao menos uma etapa do atendimento')
  .max(3)
  .transform((list) => mergeModules(list))
