import { useTabsOptions } from '@/components/navigation'
import { tabBadge, tabIcon } from '@/components/tabIcon'
import { Tabs } from 'expo-router'
import { useDay } from '@/features/promotor/DayContext'

export default function PromotorTabs() {
  const { requests } = useDay()
  const tabsOptions = useTabsOptions()
  const pending = requests.filter((r) => r.status === 'PENDENTE').length
  return (
    <Tabs
      screenOptions={tabsOptions}
    >
      <Tabs.Screen name="index" options={{ title: 'Meu dia', tabBarIcon: tabIcon('today-outline') }} />
      <Tabs.Screen
        name="liberacoes"
        options={{
          title: 'Liberações',
          tabBarBadge: tabBadge(pending),
          tabBarIcon: tabIcon('key-outline'),
        }}
      />
      <Tabs.Screen name="recusadas" options={{ title: 'Recusadas', tabBarIcon: tabIcon('close-circle-outline') }} />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  )
}
