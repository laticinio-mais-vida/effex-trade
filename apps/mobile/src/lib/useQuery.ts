import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'

/** Busca simples com estados de carregamento, erro e recarga (pull-to-refresh). */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const result = await fetcherRef.current()
      if (!mounted.current) return
      setData(result)
      setError(null)
    } catch (e) {
      if (!mounted.current) return
      if (mode !== 'silent') setError(errorMessage(e))
    } finally {
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void run('initial')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    data,
    setData,
    error,
    loading,
    refreshing,
    refresh: useCallback(() => run('refresh'), [run]),
    reload: useCallback(() => run('silent'), [run]),
  }
}
