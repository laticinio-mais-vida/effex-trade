// Define a tarefa de localização em segundo plano assim que o app (ou o processo headless) inicia.
import '@/lib/tracking'
import { useFonts } from 'expo-font'
import { Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { navigationTheme } from '@/components/navigation'
import { AuthProvider } from '@/lib/auth'
import { colors, fonts } from '@/lib/theme'
import { AutoUpdates } from '@/lib/updates'

// A tela de abertura fica até a fonte carregar, para o app não aparecer um instante com a letra do sistema
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  // Public Sans: vai junto com a atualização (arquivos em assets/fonts), sem precisar de APK novo
  const [loaded, error] = useFonts({
    [fonts.regular]: require('../../assets/fonts/PublicSans_400Regular.ttf'),
    [fonts.semibold]: require('../../assets/fonts/PublicSans_600SemiBold.ttf'),
    [fonts.bold]: require('../../assets/fonts/PublicSans_700Bold.ttf'),
    [fonts.boldItalic]: require('../../assets/fonts/PublicSans_700Bold_Italic.ttf'),
  })
  // Se a fonte falhar, o app abre com a letra do sistema em vez de ficar parado na abertura
  const ready = loaded || !!error
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])
  if (!ready) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navigationTheme}>
        <AuthProvider>
          <StatusBar style="dark" />
          <AutoUpdates />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.fundo } }} />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
