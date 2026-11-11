import { Redirect, Stack } from 'expo-router'
import { stackOptions } from '@/components/navigation'
import { LoadingView } from '@/components/ui'
import { useAuth } from '@/lib/auth'

export default function SupervisorLayout() {
  const { status, user } = useAuth()
  if (status === 'loading') return <LoadingView />
  if (!user) return <Redirect href="/login" />
  if (user.role !== 'SUPERVISOR' && user.role !== 'ADMIN') return <Redirect href="/" />

  return (
    <Stack
      screenOptions={stackOptions}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="promotor/[id]" options={{ title: 'Dia do promotor' }} />
    </Stack>
  )
}
