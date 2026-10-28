import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Card, Field, Muted, styles } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { placeOf } from '@/lib/format'
import { colors } from '@/lib/theme'
import type { Client } from '@/lib/types'

/** Busca de clientes com atraso de digitação. */
export function ClientSearch({
  fetcher,
  onSelect,
  selectedId,
  note,
}: {
  fetcher: (search: string) => Promise<Client[]>
  onSelect: (client: Client) => void
  selectedId?: string | null
  note?: (client: Client) => string | null
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const list = await fetcher(search.trim())
        if (!cancelled) {
          setResults(list)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <View style={{ gap: 10 }}>
      <Field value={search} onChangeText={setSearch} placeholder="Nome ou cidade do cliente" autoCorrect={false} />
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? <Text style={styles.errorSmall}>{error}</Text> : null}
      {!loading && results.length === 0 && !error ? <Muted>Nenhum cliente encontrado.</Muted> : null}
      {results.map((c) => {
        const extra = note?.(c)
        return (
          <Card key={c.id} onPress={() => onSelect(c)} style={selectedId === c.id && { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft }}>
            <Text style={[styles.text, { fontWeight: '700' }]}>{c.name}</Text>
            {c.city ? <Muted>{placeOf(c)}</Muted> : null}
            {extra ? <Text style={{ color: colors.warning, fontSize: 13 }}>{extra}</Text> : null}
          </Card>
        )
      })}
    </View>
  )
}
