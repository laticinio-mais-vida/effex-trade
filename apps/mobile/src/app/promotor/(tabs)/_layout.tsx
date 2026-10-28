import { tabIcon } from '@/components/tabIcon'
import { Tabs } from 'expo-router'
import { useDay } from '@/features/promotor/DayContext'
import { colors } from '@/lib/theme'

export default function PromotorTabs() {
  const { requests } = useDay()
  const pending = requests.filter((r) => r.status === 'PENDENTE').length
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Meu dia', tabBarIcon: tabIcon('today-outline') }} />
      <Tabs.Screen
        name="liberacoes"
        options={{
          title: 'Liberações',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarIcon: tabIcon('key-outline'),
        }}
      />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  )
}
