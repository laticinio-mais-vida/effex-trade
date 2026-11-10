import Ionicons from '@expo/vector-icons/Ionicons'
import { Text, type ColorValue } from 'react-native'

/** Ícone para tabBarIcon das abas. */
export function tabIcon(name: keyof typeof Ionicons.glyphMap) {
  return function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />
  }
}

/**
 * Rótulo de aba que diminui a letra até caber (com muitas abas, "Contestações" não cabe inteiro numa tela estreita
 * e o rótulo padrão corta com reticências).
 */
export function tabLabel(text?: string) {
  return function TabBarLabel({ color, children }: { color: ColorValue; children: string }) {
    return (
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color, fontSize: 11, fontWeight: '600', textAlign: 'center', paddingHorizontal: 1 }}>
        {text ?? children}
      </Text>
    )
  }
}
