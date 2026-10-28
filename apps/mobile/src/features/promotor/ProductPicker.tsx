import { Image } from 'expo-image'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Banner, Button, Muted, styles } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { colors, radius, space } from '@/lib/theme'
import type { ProductOption } from '@/lib/types'

/**
 * Seleção dos produtos que aparecem numa foto de depois. A lista traz só os produtos que o
 * cliente compra (mix); sem mix cadastrado, a API devolve o catálogo inteiro e o app avisa.
 */
export function ProductPicker({
  visible,
  visitId,
  title,
  initialSelected = [],
  previewUri,
  required,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  visible: boolean
  visitId: string
  title: string
  initialSelected?: string[]
  previewUri?: string | null
  required: boolean
  confirmLabel: string
  onConfirm: (productIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // Definido pela lista sem busca: nenhum produto do mix = cliente sem mix cadastrado
  const [noMix, setNoMix] = useState(false)

  useEffect(() => {
    if (!visible) return
    setSearch('')
    setDebounced('')
    setSelected(new Set(initialSelected))
    setNoMix(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    api<ProductOption[]>(`/promotor/products?visitId=${encodeURIComponent(visitId)}${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`)
      .then((list) => {
        if (!cancelled) {
          setItems(list)
          setError(null)
          if (!debounced) setNoMix(list.length > 0 && list.every((p) => !p.inMix))
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [visible, visitId, debounced])

  const mixCount = useMemo(() => items.filter((p) => p.inMix).length, [items])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, paddingBottom: space.sm }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>Cancelar</Text>
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            {previewUri ? <Image source={{ uri: previewUri }} style={{ width: 64, height: 64, borderRadius: radius.sm }} contentFit="cover" /> : null}
            <Muted style={{ flex: 1 }}>Marque todos os produtos que aparecem nesta foto. A lista mostra só os produtos que este cliente compra.</Muted>
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar produto por nome, código ou marca"
            placeholderTextColor={colors.faint}
            style={styles.input}
            autoCorrect={false}
          />
          {noMix ? <Banner tone="warning" text="O mix deste cliente não está cadastrado: mostrando todos os produtos." /> : null}
          {error ? <Banner tone="danger" text={error} /> : null}
        </View>
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            !debounced && !noMix && mixCount > 0 ? <Muted style={{ marginBottom: space.xs }}>{mixCount} produtos que este cliente compra</Muted> : undefined
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: space.xl }} />
            ) : (
              <Muted style={{ textAlign: 'center', marginTop: space.xl }}>Nenhum produto encontrado.</Muted>
            )
          }
          renderItem={({ item }) => {
            const on = selected.has(item.id)
            return (
              <Pressable onPress={() => toggle(item.id)} style={[styles.option, { flexDirection: 'row', alignItems: 'center', gap: space.md }, on && styles.optionActive]}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: on ? colors.primary : colors.faint,
                    backgroundColor: on ? colors.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.optionText}>{item.name}</Text>
                  <Muted>
                    {item.code}
                    {item.brand ? ` · ${item.brand}` : ''}
                  </Muted>
                </View>
              </Pressable>
            )
          }}
        />
        <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.lg, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: space.sm }}>
          <Muted>
            {selected.size === 0 ? 'Nenhum produto marcado' : `${selected.size} produto(s) marcado(s)`}
            {required && selected.size === 0 ? ': marque ao menos um.' : ''}
          </Muted>
          <Button
            title={confirmLabel}
            disabled={required && selected.size === 0}
            loading={busy}
            onPress={async () => {
              setBusy(true)
              try {
                await onConfirm([...selected])
              } finally {
                setBusy(false)
              }
            }}
          />
        </View>
      </View>
    </Modal>
  )
}
