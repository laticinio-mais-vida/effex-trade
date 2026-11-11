import { useTabsOptions } from '@/components/navigation'
import { tabBadge, tabIcon } from '@/components/tabIcon'
import { Tabs } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { fetchOpenAlerts, notifyNewAlerts } from '@/features/supervisor/alerts'
import { api } from '@/lib/api'
import { useBadgesChanged } from '@/lib/events'
import type { SupervisorSummary } from '@/lib/types'

export default function SupervisorTabs() {
  const [counts, setCounts] = useState({ requests: 0, alerts: 0, vendorAudits: 0, photos: 0, contests: 0 })
  const tabsOptions = useTabsOptions()

  const refresh = useCallback(() => {
    Promise.all([api<SupervisorSummary>('/supervisor/summary'), api<{ pending: number }>('/audit/summary')])
      .then(([s, a]) => {
        const alerts = s.openAlerts ?? 0
        setCounts({ requests: s.pendingRequests, alerts, vendorAudits: s.pendingVendorAudits, photos: a.pending, contests: s.pendingContests ?? 0 })
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
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  )
}
