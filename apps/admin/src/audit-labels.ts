import { useEffect, useRef } from 'react'
import type { AuditStatus, ReviewVerdict } from './types'

/** Mínimo de caracteres da justificativa (reprovação da foto e conferência incorreta), igual ao app */
export const MIN_JUSTIFICATION = 5

export const auditLabel: Record<AuditStatus, string> = { APROVADA: 'Aprovada', REPROVADA: 'Reprovada' }
export const verdictLabel: Record<ReviewVerdict, string> = { CORRETA: 'Correta', INCORRETA: 'Incorreta' }

/** Atalhos do visualizador: setas navegam; as letras chamam as ações (fora da caixa de texto). */
export function useViewerKeys(keys: Record<string, (() => void) | false | undefined>) {
  const ref = useRef(keys)
  useEffect(() => {
    ref.current = keys
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return
      const action = ref.current[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
