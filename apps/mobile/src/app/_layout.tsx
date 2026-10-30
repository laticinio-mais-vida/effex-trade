// Define a tarefa de localização em segundo plano assim que o app (ou o processo headless) inicia.
import '@/lib/tracking'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from '@/lib/auth'
import { colors } from '@/lib/theme'
import { AutoUpdates } from '@/lib/updates'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <AutoUpdates />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      </AuthProvider>
    </SafeAreaProvider>
  )
}
