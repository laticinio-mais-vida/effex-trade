import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'

const API_URL_KEY = 'effex.apiUrl'
/** API de produção. Fica no código porque o APK e as atualizações (eas update) não leem arquivos .env. */
const PRODUCTION_API_URL = 'https://effextrade.maisvida.cloud/api'

/**
 * Endereço padrão da API:
 * 1. EXPO_PUBLIC_API_URL (arquivo .env), se definido;
 * 2. no app instalado (APK e atualizações), a API de produção;
 * 3. em desenvolvimento, o IP da máquina que roda o Expo (mesma rede do celular), porta 3333;
 * 4. localhost (emulador/web).
 */
export function defaultApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL
  if (fromEnv) return normalizeUrl(fromEnv)
  if (!__DEV__) return PRODUCTION_API_URL
  const hostUri = Constants.expoConfig?.hostUri
  const host = hostUri?.split(':')[0]
  if (host) return `http://${host}:3333`
  return 'http://localhost:3333'
}

export function normalizeUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '')
  // Sem esquema: domínio vai com https (o APK bloqueia http); IP e localhost (rede local, desenvolvimento) com http
  if (u && !/^https?:\/\//i.test(u)) u = `${/^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(u) ? 'http' : 'https'}://${u}`
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
