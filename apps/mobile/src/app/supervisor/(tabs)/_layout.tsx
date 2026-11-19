import { useTabsOptions } from '@/components/navigation'
import { tabBadge, tabIcon } from '@/components/tabIcon'
import { Tabs } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Vibration } from 'react-native'
import { fetchOpenAlerts, notifyNewAlerts } from '@/features/supervisor/alerts'
import { api } from '@/lib/api'
import { useBadgesChanged } from '@/lib/events'
import { useSupervisorPush } from '@/lib/push'
import type { SupervisorSummary } from '@/lib/types'

export default function SupervisorTabs() {
  const [counts, setCounts] = useState({ requests: 0, alerts: 0, vendorAudits: 0, photos: 0, contests: 0, times: 0 })
  // Desvios de tempo sem ciente na última consulta (null: ainda não consultou), para avisar só os novos
  const lastTimes = useRef<number | null>(null)
  const tabsOptions = useTabsOptions()
  useSupervisorPush()

  const refresh = useCallback(() => {
    Promise.all([api<SupervisorSummary>('/supervisor/summary'), api<{ pending: number }>('/audit/summary')])
      .then(([s, a]) => {
        const alerts = s.openAlerts ?? 0
        const times = s.pendingTimeFlags ?? 0
        setCounts({ requests: s.pendingRequests, alerts, vendorAudits: s.pendingVendorAudits, photos: a.pending, contests: s.pendingContests ?? 0, times })
        if (lastTimes.current != null && times > lastTimes.current) {
          Vibration.vibrate([0, 300, 150, 300])
          Alert.alert('Tempo fora da média', `${times - lastTimes.current} novo(s) desvio(s) de tempo na sua equipe. Veja na aba Tempos.`)
        }
        lastTimes.current = times
        // Alerta novo (ex.: almoço acima do limite): avisa com diálogo e vibração, uma vez por alerta
        if (alerts > 0) fetchOpenAlerts().then(notifyNewAlerts).catch(() => {})
      })
      .catch(() => {})
  }, [])
  useBadgesChanged(refresh)
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 45_000)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <Tabs screenOptions={tabsOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Liberações',
          tabBarBadge: tabBadge(counts.requests + counts.alerts),
          tabBarIcon: tabIcon('key-outline'),
        }}
      />
      {/* Fotos reúne Avaliar, Vendedores e Contestações (seletor no topo): o contador soma as três */}
      <Tabs.Screen
        name="fotos"
        options={{
          title: 'Fotos',
          tabBarBadge: tabBadge(counts.photos + counts.vendorAudits + counts.contests),
          tabBarIcon: tabIcon('images-outline'),
        }}
      />
      <Tabs.Screen name="equipe" options={{ title: 'Equipe', tabBarIcon: tabIcon('people-outline') }} />
      <Tabs.Screen name="tempos" options={{ title: 'Tempos', tabBarBadge: tabBadge(counts.times), tabBarIcon: tabIcon('timer-outline') }} />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  )
}
