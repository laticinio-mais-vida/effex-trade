import { tabIcon } from '@/components/tabIcon'
import { Redirect, Tabs } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { LoadingView } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useBadgesChanged } from '@/lib/events'
import { colors } from '@/lib/theme'

export default function VendedorLayout() {
  const { status, user } = useAuth()
  const [pending, setPending] = useState(0)

  const refreshBadge = useCallback(() => {
    api<{ pending: number }>('/audit/summary')
      .then((s) => setPending(s.pending))
      .catch(() => {})
  }, [])
  useBadgesChanged(refreshBadge)
  useEffect(() => {
    if (!user) return
    refreshBadge()
    const timer = setInterval(refreshBadge, 60_000)
    return () => clearInterval(timer)
  }, [user, refreshBadge])

  if (status === 'loading') return <LoadingView />
  if (!user) return <Redirect href="/login" />
  if (user.role !== 'VENDEDOR') return <Redirect href="/" />

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Auditoria de fotos',
          tabBarLabel: 'Auditoria',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarIcon: tabIcon('images-outline'),
        }}
      />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  )
}
