import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, Text, View } from 'react-native'
import { Card, styles } from '@/components/ui'
import { borders, colors, radius, sizes, space, tabular, type } from '@/lib/theme'

type Item = { id: string; title: string; subtitle?: string | null }

/** Lista com botões subir/descer para propor uma nova ordem. Cliente que mudou de lugar fica com borda marinho. */
export function ReorderList({ items, order, onChange, original }: { items: Item[]; order: string[]; onChange: (order: string[]) => void; original: string[] }) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const move = (index: number, delta: number) => {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }
  return (
    <View style={{ gap: space.sm }}>
      {order.map((id, index) => {
        const item = byId.get(id)
        if (!item) return null
        const moved = original[index] !== id
        return (
          <Card
            key={id}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md }, moved && { borderColor: colors.marinho, borderWidth: borders.campo }]}
          >
            <Text style={[type.textoForte, tabular, { minWidth: space.xl, color: moved ? colors.marinho : colors.textoSecundario }]}>{index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionText} numberOfLines={2}>
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text style={styles.muted} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              <ArrowButton icon="chevron-up" label="Subir" disabled={index === 0} onPress={() => move(index, -1)} />
              <ArrowButton icon="chevron-down" label="Descer" disabled={index === order.length - 1} onPress={() => move(index, 1)} />
            </View>
          </Card>
        )
      })}
    </View>
  )
}

function ArrowButton({ icon, label, onPress, disabled }: { icon: 'chevron-up' | 'chevron-down'; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        width: sizes.toque,
        height: sizes.toque,
        borderRadius: radius.md,
        borderWidth: disabled ? 0 : borders.campo,
        borderColor: colors.marinho,
        backgroundColor: disabled ? colors.desabilitadoFundo : colors.superficie,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={sizes.icone} color={disabled ? colors.desabilitadoTexto : colors.marinho} />
    </Pressable>
  )
}
