import { Pressable, Text, View } from 'react-native'
import { Card, styles } from '@/components/ui'
import { colors, radius, space } from '@/lib/theme'

type Item = { id: string; title: string; subtitle?: string | null }

/** Lista com botões subir/descer para propor uma nova ordem. */
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
          <Card key={id} style={[{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md }, moved && { borderColor: colors.primary }]}>
            <Text style={{ width: 28, fontWeight: '800', color: moved ? colors.primary : colors.muted, fontSize: 16 }}>{index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.text, { fontWeight: '600' }]} numberOfLines={2}>
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text style={styles.muted} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <ArrowButton label="▲" disabled={index === 0} onPress={() => move(index, -1)} />
              <ArrowButton label="▼" disabled={index === order.length - 1} onPress={() => move(index, 1)} />
            </View>
          </Card>
        )
      })}
    </View>
  )
}

function ArrowButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={6}
      style={{
        width: 42,
        height: 42,
        borderRadius: radius.md,
        backgroundColor: disabled ? colors.neutralSoft : colors.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: disabled ? colors.faint : colors.primary, fontSize: 16 }}>{label}</Text>
    </Pressable>
  )
}
