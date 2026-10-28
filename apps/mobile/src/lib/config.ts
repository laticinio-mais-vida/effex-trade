import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'

const API_URL_KEY = 'effex.apiUrl'

/**
 * Endereço padrão da API:
 * 1. EXPO_PUBLIC_API_URL (arquivo .env), se definido;
 * 2. em desenvolvimento, o IP da máquina que roda o Expo (mesma rede do celular), porta 3333;
 * 3. localhost (emulador/web).
 */
export function defaultApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL
  if (fromEnv) return normalizeUrl(fromEnv)
  const hostUri = Constants.expoConfig?.hostUri
  const host = hostUri?.split(':')[0]
  if (host) return `http://${host}:3333`
  return 'http://localhost:3333'
}

export function normalizeUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`
  return u
}

let current: string | null = null

/** URL em uso (síncrona). Carregada por loadApiUrl() antes da primeira tela. */
export function apiUrl() {
  return current ?? defaultApiUrl()
}

export async function loadApiUrl() {
  if (current) return current
  try {
    current = (await AsyncStorage.getItem(API_URL_KEY)) ?? defaultApiUrl()
  } catch {
    current = defaultApiUrl()
  }
  return current
}

export async function saveApiUrl(url: string) {
  current = normalizeUrl(url)
  await AsyncStorage.setItem(API_URL_KEY, current)
  return current
}

/** URLs de foto vêm relativas (/uploads/...). */
export function resolveUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${apiUrl()}${path}`
}
