import { Pressable, Text } from 'react-native'
import { colors, radius } from '@/lib/theme'

export function FilterChip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primarySoft : colors.surface,
      }}
    >
      <Text style={{ color: active ? colors.primary : colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
        {label} ▾
      </Text>
    </Pressable>
  )
}
