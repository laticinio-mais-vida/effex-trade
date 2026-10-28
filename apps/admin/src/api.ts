const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3333').replace(/\/$/, '')
const TOKEN_KEY = 'effex.admin.token'

/** Prefixa caminhos relativos da API (ex.: fotos em /uploads/...). */
export function apiUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* sem armazenamento: a sessão dura até recarregar a página */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
}

let memoryToken: string | null = tokenStore.get()
let unauthorizedHandler: (() => void) | null = null

export function setToken(token: string | null) {
  memoryToken = token
  if (token) tokenStore.set(token)
  else tokenStore.clear()
}

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  status: number
  code?: string
  details?: unknown
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, query?: Query) {
  const url = new URL(apiUrl(path))
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  return url
}

async function request(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}) {
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers: {
      ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }).catch(() => {
    throw new ApiError(0, 'Não foi possível falar com o servidor. Verifique se a API está no ar.')
  })
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null)
    unauthorizedHandler?.()
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>)
    throw new ApiError(res.status, (data.error as string) ?? `Erro ${res.status}`, data.code as string, data.details)
  }
  return res
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const res = await request(path, opts)
  return res.json() as Promise<T>
}

/** Baixa um arquivo autenticado (ex.: PDF) e dispara o download no navegador. */
export async function downloadFile(path: string, query: Query, fallbackName: string) {
  const res = await request(path, { query })
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
