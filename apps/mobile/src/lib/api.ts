import * as SecureStore from 'expo-secure-store'
import { loadApiUrl } from './config'

const TOKEN_KEY = 'effex.token'
const secureOptions: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }

/** Erro devolvido pela API: `code` é estável (ex.: FORA_DA_CERCA) e `details` traz dados extras. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message)
  }
}

let token: string | null | undefined
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

/** Token em memória; na tarefa de segundo plano (contexto JS novo) é lido do SecureStore. */
export async function getToken() {
  if (token === undefined) token = await SecureStore.getItemAsync(TOKEN_KEY, secureOptions).catch(() => null)
  return token
}

export async function setToken(value: string | null) {
  token = value
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value, secureOptions)
  else await SecureStore.deleteItemAsync(TOKEN_KEY, secureOptions).catch(() => {})
}

type Options = { method?: string; body?: unknown; form?: FormData; timeoutMs?: number; auth?: boolean }

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const base = await loadApiUrl()
  const auth = opts.auth !== false ? await getToken() : null
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (auth) headers.Authorization = `Bearer ${auth}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? (opts.form ? 90_000 : 25_000))
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: controller.signal,
    })
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ApiError(0, `O servidor (${base}) demorou demais para responder. Verifique a internet e tente de novo.`, 'SEM_CONEXAO')
    }
    // O fetch também falha antes de sair do aparelho (ex.: anexo em formato inválido): mostra a causa real
    const detail = e instanceof Error ? e.message : String(e)
    const network = /network|failed to connect|unable to resolve|unreachable|connection|timed? ?out|host/i.test(detail)
    if (network) throw new ApiError(0, `Sem conexão com o servidor (${base}). Verifique a internet e tente de novo.`, 'SEM_CONEXAO', { detail })
    throw new ApiError(0, `Não foi possível enviar ao servidor: ${detail}`, 'FALHA_ENVIO', { detail })
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    if (res.status === 401 && auth) onUnauthorized?.()
    const message = (data && typeof data === 'object' && data.error) || `Erro ${res.status} no servidor.`
    throw new ApiError(res.status, message, data?.code, data?.details)
  }
  return data as T
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Algo deu errado. Tente de novo.'
}
