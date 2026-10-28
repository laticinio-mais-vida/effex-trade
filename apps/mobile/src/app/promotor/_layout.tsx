import { Redirect, Stack } from 'expo-router'
import { LoadingView } from '@/components/ui'
import { DayProvider } from '@/features/promotor/DayContext'
import { useAuth } from '@/lib/auth'
import { colors } from '@/lib/theme'

export default function PromotorLayout() {
  const { status, user } = useAuth()
  if (status === 'loading') return <LoadingView />
  if (!user) return <Redirect href="/login" />
  if (user.role !== 'PROMOTOR') return <Redirect href="/" />

  return (
    <DayProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
          headerBackTitle: 'Voltar',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="visita/[id]" options={{ title: 'Atendimento' }} />
        <Stack.Screen name="adicionar" options={{ title: 'Incluir cliente extra' }} />
        <Stack.Screen name="pedido" options={{ title: 'Pedir liberação' }} />
        <Stack.Screen name="ordem" options={{ title: 'Alterar ordem' }} />
        <Stack.Screen name="encerrar" options={{ title: 'Encerrar roteiro' }} />
      </Stack>
    </DayProvider>
  )
}
