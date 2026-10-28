import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from './api'
import { loadApiUrl } from './config'
import { clearTrackingData, flushQueue, stopTracking } from './tracking'
import type { Role, User } from './types'

const USER_KEY = 'effex.user'

type AuthContextValue = {
  status: 'loading' | 'signedOut' | 'signedIn'
  user: User | null
  login: (login: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')
  const [user, setUser] = useState<User | null>(null)

  const logout = useCallback(async () => {
    await flushQueue()
    await stopTracking()
    await clearTrackingData()
    await setToken(null)
    await AsyncStorage.removeItem(USER_KEY)
    setUser(null)
    setStatus('signedOut')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout()
    })
    return () => setUnauthorizedHandler(null)
  }, [logout])

  useEffect(() => {
    ;(async () => {
      await loadApiUrl()
      const token = await getToken()
      const cached = await AsyncStorage.getItem(USER_KEY)
      if (!token || !cached) {
        setStatus('signedOut')
        return
      }
      setUser(JSON.parse(cached))
      setStatus('signedIn')
      // Atualiza perfil em segundo plano; sem internet segue com o cache.
      try {
        const me = await api<User>('/auth/me')
        setUser(me)
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(me))
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await logout()
      }
    })()
  }, [logout])

  const login = useCallback(async (loginName: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { body: { login: loginName.trim(), password }, auth: false })
    await setToken(res.token)
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user))
    setUser(res.user)
    setStatus('signedIn')
  }, [])

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

/** Rota inicial de cada perfil. Admin usa o módulo do supervisor no app. */
export function homeFor(role: Role) {
  if (role === 'PROMOTOR') return '/promotor' as const
  if (role === 'VENDEDOR') return '/vendedor' as const
  return '/supervisor' as const
}

export const roleLabels: Record<Role, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  VENDEDOR: 'Vendedor',
  PROMOTOR: 'Promotor',
}
