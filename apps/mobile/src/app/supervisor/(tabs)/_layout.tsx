import { tabIcon } from '@/components/tabIcon'
import { Tabs } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { fetchOpenAlerts, notifyNewAlerts } from '@/features/supervisor/alerts'
import { api } from '@/lib/api'
import { useBadgesChanged } from '@/lib/events'
import { colors } from '@/lib/theme'
import type { SupervisorSummary } from '@/lib/types'

export default function SupervisorTabs() {
  const [counts, setCounts] = useState({ requests: 0, alerts: 0, vendorAudits: 0, photos: 0 })

  const refresh = useCallback(() => {
    Promise.all([api<SupervisorSummary>('/supervisor/summary'), api<{ pending: number }>('/audit/summary')])
      .then(([s, a]) => {
        const alerts = s.openAlerts ?? 0
        setCounts({ requests: s.pendingRequests, alerts, vendorAudits: s.pendingVendorAudits, photos: a.pending })
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

  const badge = (n: number) => (n > 0 ? (n > 99 ? '99+' : n) : undefined)

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Liberações',
          tabBarBadge: badge(counts.requests + counts.alerts),
          tabBarIcon: tabIcon('key-outline'),
        }}
      />
      <Tabs.Screen
        name="fotos"
        options={{
          title: 'Auditoria de fotos',
          tabBarLabel: 'Fotos',
          tabBarBadge: badge(counts.photos),
          tabBarIcon: tabIcon('images-outline'),
        }}
      />
      <Tabs.Screen
        name="vendedores"
        options={{
          title: 'Auditorias dos vendedores',
          tabBarLabel: 'Vendedores',
          tabBarBadge: badge(counts.vendorAudits),
          tabBarIcon: tabIcon('checkmark-done-outline'),
        }}
      />
      <Tabs.Screen name="equipe" options={{ title: 'Equipe', tabBarIcon: tabIcon('people-outline') }} />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  )
}
