import Ionicons from '@expo/vector-icons/Ionicons'
import type { ColorValue } from 'react-native'

/** Ícone para tabBarIcon das abas. */
export function tabIcon(name: keyof typeof Ionicons.glyphMap) {
  return function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />
  }
}
