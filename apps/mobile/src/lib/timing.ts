import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { Platform, Vibration } from 'react-native'
import { formatShort } from './format'
import type { Timing, TimingFlag } from './types'

/**
 * Avisos de tempo acima do normal para o promotor. Dois caminhos:
 * - na hora: o check-in e o check-out devolvem os desvios novos (`timing.flags`) e o app mostra o aviso na tela;
 * - com o app minimizado: o check-in devolve em quantos segundos o atendimento passa do limite (e o check-out, o do
 *   deslocamento), e o app agenda uma notificação local para esse horário. Ela é cancelada se o promotor sair antes do
 *   limite, e não precisa de servidor de notificação.
 * Nada aqui pode travar o atendimento: qualquer falha de notificação é ignorada.
 */

const CHANNEL = 'tempos'
const STAY_ID = 'tempo-no-cliente'
const TRAVEL_ID = 'tempo-deslocamento'

/** Mostra o aviso também com o app aberto. Chamar uma vez, na abertura do app. */
export function setupTimeNotifications() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    })
  } catch {}
}

let permission: Promise<boolean> | null = null

/** Canal (Android) e permissão de notificações; pede a permissão uma vez. */
export function ensureNotifications() {
  permission ??= (async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL, {
          name: 'Tempo acima do normal',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 300, 200, 300],
        })
      }
      const current = await Notifications.getPermissionsAsync()
      if (current.granted) return true
      if (!current.canAskAgain) return false
      return (await Notifications.requestPermissionsAsync()).granted
    } catch {
      return false
    }
  })()
  return permission
}

async function schedule(id: string, title: string, body: string, seconds: number) {
  if (!(await ensureNotifications())) return
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(seconds)), channelId: CHANNEL },
  })
}

const cancel = (id: string) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})

/** Cancela os avisos agendados (ex.: almoço, fim do roteiro). */
export function cancelTimeAlerts() {
  return Promise.all([cancel(STAY_ID), cancel(TRAVEL_ID)]).then(() => undefined)
}

/** Cancela só o aviso de deslocamento (ex.: o promotor foi almoçar). */
export function cancelTravelAlert() {
  return cancel(TRAVEL_ID)
}

/** Texto de um desvio para o promotor. */
export function describeFlag(f: TimingFlag) {
  return f.kind === 'ROTEIRO'
    ? `Você ficou ${formatShort(f.valueSeconds)} em ${f.clientName}. O normal neste cliente é ${formatShort(f.baseSeconds)}.`
    : `Seu deslocamento até ${f.clientName} foi de ${formatShort(f.valueSeconds)}. O normal é ${formatShort(f.baseSeconds)}.`
}

type FlagListener = (flags: TimingFlag[]) => void
const listeners = new Set<FlagListener>()

/** Quem mostra o aviso na tela (TimingPrompt) escuta aqui. */
export function useTimingFlags(listener: FlagListener) {
  useEffect(() => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [listener])
}

/** Aplica o que o check-in ou check-out devolveu: agenda ou cancela as notificações e mostra os desvios novos. */
export async function applyTiming(timing: Timing | undefined, event: 'checkin' | 'checkout') {
  if (!timing) return
  try {
    if (event === 'checkin') {
      await cancel(TRAVEL_ID)
      if (timing.stayLimit) {
        const { clientName, afterSeconds, baseSeconds } = timing.stayLimit
        await schedule(STAY_ID, 'Tempo acima do normal', `Você já passou do tempo normal em ${clientName} (cerca de ${formatShort(baseSeconds)}). Se precisar, explique depois no app.`, afterSeconds)
      }
    } else {
      await cancel(STAY_ID)
      if (timing.travelLimit) {
        await schedule(TRAVEL_ID, 'Deslocamento acima do normal', `Seu deslocamento já passou do normal (cerca de ${formatShort(timing.travelLimit.baseSeconds)}).`, timing.travelLimit.afterSeconds)
      }
    }
  } catch {}
  if (timing.flags.length) {
    Vibration.vibrate([0, 300, 150, 300])
    listeners.forEach((l) => l(timing.flags))
  }
}
