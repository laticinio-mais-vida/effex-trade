import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Battery from 'expo-battery'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { api, getToken } from './api'

/**
 * Rastreamento do promotor durante a jornada.
 * - App instalado (development build / APK): tarefa de localização em segundo plano com serviço em
 *   primeiro plano no Android (notificação fixa).
 * - Expo Go ou sem permissão "o tempo todo": envio periódico só enquanto o app está aberto.
 * Pings ficam numa fila local e são reenviados em lote quando a internet volta.
 */

export const LOCATION_TASK = 'effex-location-tracking'
const QUEUE_KEY = 'effex.pingQueue'
const LAST_PING_KEY = 'effex.lastPingAt'
const INTERVAL_KEY = 'effex.trackingIntervalMin'
const MAX_QUEUE = 3000

export type TrackingMode = 'background' | 'foreground' | 'off'

type Ping = { latitude: number; longitude: number; accuracy?: number; mocked?: boolean; battery?: number; recordedAt: string }

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

async function intervalMs() {
  const stored = Number(await AsyncStorage.getItem(INTERVAL_KEY))
  return (stored > 0 ? stored : 3) * 60_000
}

async function batteryLevel() {
  try {
    const level = await Battery.getBatteryLevelAsync()
    return level >= 0 ? Math.round(level * 100) / 100 : undefined
  } catch {
    return undefined
  }
}

/** Grava pings respeitando o intervalo mínimo entre eles. */
export async function recordLocations(locations: Location.LocationObject[], force = false) {
  if (locations.length === 0) return
  const every = (await intervalMs()) * 0.9
  let last = Number(await AsyncStorage.getItem(LAST_PING_KEY)) || 0
  const battery = await batteryLevel()
  const accepted: Ping[] = []
  for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
    if (!force && loc.timestamp - last < every) continue
    last = loc.timestamp
    accepted.push({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? undefined,
      mocked: loc.mocked ?? false,
      battery,
      recordedAt: new Date(loc.timestamp).toISOString(),
    })
  }
  if (accepted.length === 0) return
  await AsyncStorage.setItem(LAST_PING_KEY, String(last))
  const queue = await readQueue()
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, ...accepted].slice(-MAX_QUEUE)))
  await flushQueue()
}

async function readQueue(): Promise<Ping[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

let flushing: Promise<void> | null = null

/** Envia a fila em lotes de 200. Falhas de rede mantêm os pings para a próxima tentativa. */
export function flushQueue() {
  if (!flushing) {
    flushing = (async () => {
      try {
        if (!(await getToken())) return
        let queue = await readQueue()
        while (queue.length > 0) {
          const batch = queue.slice(0, 200)
          await api('/tracking/pings', { body: { pings: batch } })
          queue = (await readQueue()).slice(batch.length)
          await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
        }
      } catch {
        // sem conexão ou erro do servidor: tenta de novo no próximo ping
      } finally {
        flushing = null
      }
    })()
  }
  return flushing
}

export async function pendingPings() {
  return (await readQueue()).length
}

export async function clearTrackingData() {
  await AsyncStorage.multiRemove([QUEUE_KEY, LAST_PING_KEY])
}

// A tarefa precisa ser definida no escopo do módulo (importado pelo layout raiz).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return
  await recordLocations(data.locations)
})

/** Liga o rastreamento. Retorna o modo efetivo e, se for o caso, o motivo de não estar em segundo plano. */
export async function startTracking(intervalMinutes: number): Promise<{ mode: TrackingMode; reason?: string }> {
  await AsyncStorage.setItem(INTERVAL_KEY, String(intervalMinutes))
  let fg = await Location.getForegroundPermissionsAsync()
  if (!fg.granted) fg = await Location.requestForegroundPermissionsAsync()
  if (!fg.granted) return { mode: 'off', reason: 'Permissão de localização negada.' }

  if (isExpoGo) return { mode: 'foreground', reason: 'No Expo Go a localização só é enviada com o app aberto.' }
  if (!(await TaskManager.isAvailableAsync())) return { mode: 'foreground', reason: 'Segundo plano indisponível neste aparelho.' }

  let bg = await Location.getBackgroundPermissionsAsync()
  if (!bg.granted) bg = await Location.requestBackgroundPermissionsAsync()
  if (!bg.granted) return { mode: 'foreground', reason: 'Para enviar a localização com o app fechado, permita a localização "o tempo todo".' }

  try {
    const ms = intervalMinutes * 60_000
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: ms,
      distanceInterval: 0,
      deferredUpdatesInterval: ms,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.AutomotiveNavigation,
      foregroundService: {
        notificationTitle: 'EFFEX Trade - jornada em andamento',
        notificationBody: 'Sua localização está sendo enviada ao supervisor.',
        notificationColor: '#0B6E4F',
      },
    })
    return { mode: 'background' }
  } catch (e) {
    return { mode: 'foreground', reason: e instanceof Error ? e.message : 'Falha ao iniciar o segundo plano.' }
  }
}

export async function stopTracking() {
  try {
    if (!isExpoGo && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
  } catch {
    // tarefa não registrada
  }
}

/** Coleta uma posição agora (modo primeiro plano). */
export async function pingNow(force = false) {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (!perm.granted) return
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    await recordLocations([loc], force)
  } catch {
    // GPS indisponível no momento
  }
}
