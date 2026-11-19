import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { api } from './api'

/**
 * Notificação push do supervisor (Firebase), para os avisos chegarem com o app fechado: tempo acima da média,
 * atendimento ou deslocamento passando do limite, almoço longo. O app entrega ao servidor o "endereço" do celular
 * (token FCM) a cada abertura; o servidor (api/src/services/push.ts) é quem envia. Sem o google-services.json no
 * build, não há token e nada disso acontece: o app segue com os avisos de dentro dele. Nenhuma falha daqui trava o app.
 */

const CHANNEL = 'supervisor'
let current: string | null = null

async function register() {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Avisos da equipe',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 200, 300],
    })
    const perm = await Notifications.getPermissionsAsync()
    const granted = perm.granted || (perm.canAskAgain && (await Notifications.requestPermissionsAsync()).granted)
    if (!granted) return
    const { data } = await Notifications.getDevicePushTokenAsync()
    if (typeof data !== 'string' || !data) return
    current = data
    await api('/auth/push-token', { body: { token: data } })
  } catch {
    // sem Firebase no build, sem internet ou servidor antigo: segue sem push
  }
}

/** Registra o celular e abre a aba certa quando o supervisor toca no aviso. Usar no layout do supervisor. */
export function useSupervisorPush() {
  useEffect(() => {
    void register()
    const tokenSub = Notifications.addPushTokenListener(() => void register())
    const openScreen = (data: unknown) => {
      const screen = (data as { screen?: string } | null)?.screen
      if (screen === 'tempos') router.navigate('/supervisor/tempos')
      else if (screen === 'index') router.navigate('/supervisor')
    }
    const tapSub = Notifications.addNotificationResponseReceivedListener((r) => openScreen(r.notification.request.content.data))
    // App aberto pelo toque no aviso (estava fechado)
    void Notifications.getLastNotificationResponseAsync().then((r) => r && openScreen(r.notification.request.content.data))
    return () => {
      tokenSub.remove()
      tapSub.remove()
    }
  }, [])
}

/** Ao sair da conta, o celular deixa de receber os avisos dela. Chamar antes de apagar o token de login. */
export async function unregisterPush() {
  const token = current
  current = null
  if (!token) return
  try {
    await api('/auth/push-token/remove', { body: { token } })
  } catch {}
}
