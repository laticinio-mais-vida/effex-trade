import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, Text } from 'react-native'
import { borders, colors, radius, sizes, space, type } from '@/lib/theme'

/** Botão de filtro que abre uma lista. Com filtro aplicado, a borda fica marinho. */
export function FilterChip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: sizes.toque,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: borders.campo,
        borderColor: active ? colors.marinho : colors.bordaCampo,
        backgroundColor: colors.superficie,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={[type.rotulo, { color: active ? colors.marinho : colors.textoSecundario }]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={sizes.iconeComTexto - 4} color={active ? colors.marinho : colors.textoSecundario} />
    </Pressable>
  )
}
