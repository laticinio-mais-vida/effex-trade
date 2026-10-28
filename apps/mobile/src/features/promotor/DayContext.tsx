import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, AppState } from 'react-native'
import { api } from '@/lib/api'
import { flushQueue, pingNow, startTracking, stopTracking, type TrackingMode } from '@/lib/tracking'
import type { Day, PermissionRequest } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'

type DayContextValue = {
  day: Day | null
  requests: PermissionRequest[]
  loading: boolean
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
  reload: () => Promise<void>
  tracking: { mode: TrackingMode; reason?: string }
}

const DayContext = createContext<DayContextValue | null>(null)

/** Estado do dia do promotor compartilhado entre as telas (roteiro, pedidos e rastreamento). */
export function DayProvider({ children }: { children: ReactNode }) {
  const query = useQuery(async () => {
    const [day, requests] = await Promise.all([api<Day>('/promotor/day'), api<PermissionRequest[]>('/promotor/requests')])
    return { day, requests }
  })
  const day = query.data?.day ?? null
  const requests = query.data?.requests ?? []
  const [tracking, setTracking] = useState<DayContextValue['tracking']>({ mode: 'off' })

  // Rastreamento ligado entre o início e o encerramento do roteiro de hoje
  const active = !!day?.isToday && !!day.workDay?.startedAt && !dayClosed(day)
  const interval = day?.rules.trackingIntervalMinutes ?? 3
  useEffect(() => {
    let cancelled = false
    if (!active) {
      void stopTracking()
      setTracking({ mode: 'off' })
      return
    }
    startTracking(interval).then((result) => {
      if (!cancelled) setTracking(result)
    })
    return () => {
      cancelled = true
    }
  }, [active, interval])

  // Modo primeiro plano (Expo Go / sem permissão "o tempo todo"): envia enquanto o app está aberto
  useEffect(() => {
    if (!active || tracking.mode !== 'foreground') return
    void pingNow(true)
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void pingNow()
    }, interval * 60_000)
    return () => clearInterval(timer)
  }, [active, tracking.mode, interval])

  // Ao voltar para o app: reenvia pings pendentes e atualiza o dia
  const reload = query.reload
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void flushQueue()
        void reload()
      }
    })
    return () => sub.remove()
  }, [reload])

  // Enquanto houver pedido aguardando o supervisor, consulta a cada 20 s
  const hasPending = requests.some((r) => r.status === 'PENDENTE')
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => void reload(), 20_000)
    return () => clearInterval(timer)
  }, [hasPending, reload])

  // Avisa quando um pedido pendente é decidido
  const previous = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!query.data) return
    const before = previous.current
    if (before) {
      for (const r of requests) {
        if (before.get(r.id) === 'PENDENTE' && r.status !== 'PENDENTE' && r.status !== 'CANCELADA') {
          const approved = r.status === 'APROVADA'
          Alert.alert(
            approved ? 'Liberação aprovada' : 'Liberação negada',
            `${r.typeLabel}${r.visit ? ` - ${r.visit.client.name}` : ''}${r.decisionNote ? `\n\n${r.decidedBy?.name ?? 'Supervisor'}: ${r.decisionNote}` : ''}`,
          )
        }
      }
    }
    previous.current = new Map(requests.map((r) => [r.id, r.status]))
  }, [query.data, requests])

  const value: DayContextValue = {
    day,
    requests,
    loading: query.loading,
    refreshing: query.refreshing,
    error: query.error,
    refresh: query.refresh,
    reload: useCallback(() => query.reload(), [query.reload]),
    tracking,
  }
  return <DayContext.Provider value={value}>{children}</DayContext.Provider>
}

export function useDay() {
  const ctx = useContext(DayContext)
  if (!ctx) throw new Error('useDay fora do DayProvider')
  return ctx
}

/** Roteiro encerrado (pelo promotor ou pelo sistema). */
export function dayClosed(day: Day | null | undefined) {
  return !!(day?.workDay?.closedAt ?? day?.workDay?.endedAt)
}

/** Almoço aberto: nenhuma atividade até abrir (ou justificar) o próximo cliente. */
export function onLunch(day: Day | null | undefined) {
  return !!day?.workDay?.lunchStartedAt && !day.workDay.lunchEndedAt
}

export const permissionLabels: Record<string, string> = {
  CHECKIN_FORA_CERCA: 'Check-in fora da cerca eletrônica',
  DISPENSA_FOTOS: 'Liberar sem fotos obrigatórias',
  ALTERAR_ORDEM: 'Alterar ordem de atendimento',
  LIVRE_ORDEM_CLIENTE: 'Atender cliente fora da ordem',
  LIVRE_ORDEM_DIA: 'Dia sem ordem do roteiro',
  SUBSTITUIR_CLIENTE: 'Substituir cliente do roteiro',
}
