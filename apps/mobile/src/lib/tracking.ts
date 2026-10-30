import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Battery from 'expo-battery'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { api, getToken } from './api'
import { distanceMeters } from './location'

/**
 * Rastreamento do promotor durante a jornada.
 * - App instalado (development build / APK): tarefa de localização em segundo plano com serviço em
 *   primeiro plano no Android (notificação fixa).
 * - Expo Go ou sem permissão "o tempo todo": envio periódico só enquanto o app está aberto.
 * Pings ficam numa fila local e são reenviados em lote quando a internet volta.
 * Dentro da loja, um ponto a cada intervalo (regra "Intervalo de envio da localização"). Fora da loja, para o km
 * percorrido (GPS) do relatório, o GPS de alta precisão guarda um ponto a cada X segundos andando ou a cada Y metros
 * (regras "no deslocamento"); parado, só a cada intervalo.
 */

export const LOCATION_TASK = 'effex-location-tracking'
const QUEUE_KEY = 'effex.pingQueue'
const LAST_PING_KEY = 'effex.lastPingAt'
const LAST_POINT_KEY = 'effex.lastPingPoint'
const INTERVAL_KEY = 'effex.trackingIntervalMin'
const MOVING_KEY = 'effex.trackingMoving'
const MAX_QUEUE = 3000
/** Andou menos que isto desde o último ponto: está parado (o GPS oscila uns metros mesmo sem sair do lugar). */
const STILL_M = 50
/** Fora da loja os pontos vão em lote: envia quando o mais antigo da fila tem este tempo (não acorda a rede a cada ponto). */
const MOVING_SEND_MS = 2 * 60_000

export type TrackingMode = 'background' | 'foreground' | 'off'
/** Fora da loja: guarda um ponto a cada `seconds` andando ou a cada `meters`. */
export type MovingRules = { seconds: number; meters: number }

type Ping = { latitude: number; longitude: number; accuracy?: number; mocked?: boolean; battery?: number; recordedAt: string }
type Point = { latitude: number; longitude: number }

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

async function intervalMs() {
  const stored = Number(await AsyncStorage.getItem(INTERVAL_KEY))
  return (stored > 0 ? stored : 3) * 60_000
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key)) ?? 'null')
  } catch {
    return null
  }
}

async function batteryLevel() {
  try {
    const level = await Battery.getBatteryLevelAsync()
    return level >= 0 ? Math.round(level * 100) / 100 : undefined
  } catch {
    return undefined
  }
}

/**
 * Grava pings respeitando o intervalo mínimo entre eles. Fora da loja, também guarda o ponto quando o promotor andou
 * `meters`, ou quando passaram `seconds` e ele saiu do lugar.
 */
export async function recordLocations(locations: Location.LocationObject[], force = false) {
  if (locations.length === 0) return
  const every = (await intervalMs()) * 0.9
  const moving = await readJson<MovingRules>(MOVING_KEY)
  let last = Number(await AsyncStorage.getItem(LAST_PING_KEY)) || 0
  let lastPoint = await readJson<Point>(LAST_POINT_KEY)
  const battery = await batteryLevel()
  const accepted: Ping[] = []
  for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
    const elapsed = loc.timestamp - last
    const moved = lastPoint ? distanceMeters(lastPoint.latitude, lastPoint.longitude, loc.coords.latitude, loc.coords.longitude) : Infinity
    const keep =
      force || elapsed >= every || (!!moving && elapsed > 0 && (moved >= moving.meters || (elapsed >= moving.seconds * 1000 * 0.9 && moved >= STILL_M)))
    if (!keep) continue
    last = loc.timestamp
    lastPoint = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
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
  await AsyncStorage.multiSet([
    [LAST_PING_KEY, String(last)],
    [LAST_POINT_KEY, JSON.stringify(lastPoint)],
  ])
  const queue = [...(await readQueue()), ...accepted].slice(-MAX_QUEUE)
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  if (!moving || force || Date.now() - Date.parse(queue[0]!.recordedAt) >= MOVING_SEND_MS) await flushQueue()
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
  await AsyncStorage.multiRemove([QUEUE_KEY, LAST_PING_KEY, LAST_POINT_KEY])
}

// A tarefa precisa ser definida no escopo do módulo (importado pelo layout raiz).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return
  await recordLocations(data.locations)
})

/**
 * Liga o rastreamento (ou troca as opções dele). `moving` = fora da loja. Retorna o modo efetivo e, se for o caso, o
 * motivo de não estar em segundo plano. O Android só aceita com o app aberto.
 */
export async function startTracking(intervalMinutes: number, moving: MovingRules | null = null): Promise<{ mode: TrackingMode; reason?: string }> {
  await AsyncStorage.multiSet([
    [INTERVAL_KEY, String(intervalMinutes)],
    [MOVING_KEY, JSON.stringify(moving)],
  ])
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
    // Fora da loja: GPS de alta precisão lido a cada poucos segundos (o bastante para pegar os `meters` a ~70 km/h),
    // entregue em lotes de 1 min; recordLocations escolhe o que guardar. Na loja: um ponto por intervalo, como antes.
    const movingReadMs = moving ? Math.round(Math.min(30, Math.max(5, Math.min(moving.seconds, moving.meters / 20)))) * 1000 : 0
    // Ligar de novo por cima só troca as opções. Parar antes desligaria o serviço em primeiro plano (a notificação fixa),
    // e o Android não deixa religá-lo se o app já estiver em segundo plano.
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...(moving
        ? { accuracy: Location.Accuracy.High, timeInterval: movingReadMs, deferredUpdatesInterval: 60_000 }
        : { accuracy: Location.Accuracy.Balanced, timeInterval: ms, deferredUpdatesInterval: ms }),
      distanceInterval: 0,
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
    const moving = await readJson<MovingRules>(MOVING_KEY)
    const loc = await Location.getCurrentPositionAsync({ accuracy: moving ? Location.Accuracy.High : Location.Accuracy.Balanced })
    await recordLocations([loc], force)
  } catch {
    // GPS indisponível no momento
  }
}
