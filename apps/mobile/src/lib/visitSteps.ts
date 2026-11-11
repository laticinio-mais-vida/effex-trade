import { DEFAULT_MODULES } from './format'
import type { DayRules, Visit } from './types'

export type StepKey = 'FACHADA' | 'ANTES' | 'DEPOIS' | 'RUPTURA' | 'ESTOQUE' | 'TAREFA' | 'CHECKOUT'

/**
 * Passos do atendimento na ordem (as atividades obrigatórias contam como um passo antes do check-out) e o passo
 * atual: com a sequência obrigatória, o que a API aponta; sem ela, o primeiro pendente na ordem normal. Usado pelo
 * Atendimento (barra fixa) e pelo cartão "Agora" do Meu dia.
 */
export function visitSteps(visit: Visit, rules: DayRules) {
  const photos = visit.photos ?? []
  const tasks = visit.tasks ?? []
  const modules = visit.modules ?? DEFAULT_MODULES
  const progress = visit.progress
  const enforced = progress?.enforced ?? false
  const needsFacade = rules.requireFacadePhotoOnCheckin && !visit.photosWaived
  const afterPhotos = photos.filter((p) => p.type === 'DEPOIS')
  const pendingRequired = tasks.filter((t) => t.required && !t.done && !(t.requiresPhoto && visit.photosWaived))
  const requiredTasks = tasks.filter((t) => t.required && !(t.requiresPhoto && visit.photosWaived))

  const steps: { key: StepKey; done: boolean }[] = [
    { key: 'FACHADA', done: !needsFacade || photos.some((p) => p.type === 'FACHADA') },
  ]
  if (modules.includes('FOTOS')) {
    steps.push(
      { key: 'ANTES', done: photos.some((p) => p.type === 'ANTES') },
      { key: 'DEPOIS', done: afterPhotos.length > 0 && afterPhotos.every((p) => (p.products?.length ?? 0) > 0) },
      { key: 'RUPTURA', done: !!progress?.ruptureConfirmed },
    )
  }
  if (modules.includes('ESTOQUE')) steps.push({ key: 'ESTOQUE', done: !!progress?.stockConfirmed })
  if (requiredTasks.length > 0) steps.push({ key: 'TAREFA', done: pendingRequired.length === 0 })
  steps.push({ key: 'CHECKOUT', done: false })

  const next = progress?.next ?? 'CHECKOUT'
  const apiCurrent: StepKey = next === 'CHECKOUT' && pendingRequired.length > 0 ? 'TAREFA' : next === 'PRODUTOS' ? 'DEPOIS' : (next as StepKey)
  const current: StepKey = enforced ? apiCurrent : (steps.find((s) => !s.done)?.key ?? 'CHECKOUT')
  const stepNo = steps.findIndex((s) => s.key === current) + 1
  const remaining = steps.filter((s) => !s.done).length
  return { steps, current, stepNo, total: steps.length, remaining, enforced, pendingRequired, requiredTasks }
}

export const stepTitles: Record<StepKey, string> = {
  FACHADA: 'Foto da fachada',
  ANTES: 'Foto de antes',
  DEPOIS: 'Fotos de depois, marcando os produtos',
  RUPTURA: 'Confirmar ruptura',
  ESTOQUE: 'Contagem de estoque',
  TAREFA: 'Atividades obrigatórias',
  CHECKOUT: 'Check-out',
}

/** "Passo 3 de 5 · faltam 3 para o check-out" */
export function stepLine({ stepNo, total, remaining }: { stepNo: number; total: number; remaining: number }) {
  return `Passo ${stepNo} de ${total} · ${remaining <= 1 ? 'falta só o check-out' : `faltam ${remaining} para o check-out`}`
}
