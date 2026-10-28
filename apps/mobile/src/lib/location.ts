import * as Location from 'expo-location'

export type CurrentLocation = { latitude: number; longitude: number; accuracy?: number; mocked?: boolean }

export class LocationError extends Error {}

async function ensureForegroundPermission() {
  const current = await Location.getForegroundPermissionsAsync()
  if (current.granted) return
  const asked = await Location.requestForegroundPermissionsAsync()
  if (!asked.granted) throw new LocationError('Permita o acesso à localização nas configurações do celular para continuar.')
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new LocationError('O GPS demorou para responder. Vá para um local aberto e tente de novo.')), ms))])
}

function toCurrent(loc: Location.LocationObject): CurrentLocation {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy ?? undefined,
    mocked: loc.mocked ?? false,
  }
}

/** Posição atual em alta precisão (check-in / check-out). */
export async function getPreciseLocation(): Promise<CurrentLocation> {
  await ensureForegroundPermission()
  const enabled = await Location.hasServicesEnabledAsync()
  if (!enabled) throw new LocationError('Ative o GPS (localização) do celular para continuar.')
  return toCurrent(await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 25_000))
}

/** Posição aproximada, sem travar a tela (fotos, pedidos, justificativas). Pode retornar null. */
export async function getQuickLocation(): Promise<CurrentLocation | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (!perm.granted) return null
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 })
    if (last) return toCurrent(last)
    return toCurrent(await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 8_000))
  } catch {
    return null
  }
}

/** Distância em metros entre dois pontos (haversine), para avisar antes de abrir a câmera. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}
