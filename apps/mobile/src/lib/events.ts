import { useEffect } from 'react'

type Listener = () => void
const listeners = new Set<Listener>()

/** Avisa as abas que algo mudou (ex.: auditoria feita) para atualizar os contadores. */
export function emitBadgesChanged() {
  for (const l of listeners) l()
}

export function useBadgesChanged(listener: Listener) {
  useEffect(() => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [listener])
}
