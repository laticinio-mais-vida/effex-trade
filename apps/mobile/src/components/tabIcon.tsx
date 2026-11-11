import Ionicons from '@expo/vector-icons/Ionicons'
import { Text, type ColorValue } from 'react-native'
import { sizes, type } from '@/lib/theme'

type IconName = keyof typeof Ionicons.glyphMap

/** Ícone de aba: contorno no estado normal, preenchido na aba ativa (o nome sem "-outline"). */
export function tabIcon(name: IconName) {
  const filled = name.replace(/-outline$/, '') as IconName
  const active: IconName = filled in Ionicons.glyphMap ? filled : name
  return function TabBarIcon({ color, focused }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : name} color={color as string} size={sizes.icone} />
  }
}

/** Contador da aba: some no zero e vira "99+" acima de 99. */
export function tabBadge(n: number): number | string | undefined {
  if (n <= 0) return undefined
  return n > 99 ? '99+' : n
}

/**
 * Rótulo de aba que diminui a letra até caber (com muitas abas, "Contestações" não cabe inteiro numa tela estreita
 * e o rótulo padrão corta com reticências).
 */
export function tabLabel(text?: string) {
  return function TabBarLabel({ color, children }: { color: ColorValue; children: string }) {
    return (
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[type.selo, { color, textAlign: 'center', paddingHorizontal: 1 }]}>
        {text ?? children}
      </Text>
    )
  }
}
