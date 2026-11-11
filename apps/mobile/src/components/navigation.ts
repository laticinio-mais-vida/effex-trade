import { DefaultTheme, type Theme } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { borders, colors, fonts, space, type } from '@/lib/theme'

/** Tema da navegação: cores e Public Sans no cabeçalho e nas abas (o React Navigation lê daqui). */
export const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.marinho,
    background: colors.fundo,
    card: colors.superficie,
    text: colors.texto,
    border: colors.divisoria,
    notification: colors.marinho,
  },
  fonts: {
    regular: { fontFamily: fonts.regular, fontWeight: 'normal' },
    medium: { fontFamily: fonts.semibold, fontWeight: 'normal' },
    bold: { fontFamily: fonts.bold, fontWeight: 'normal' },
    heavy: { fontFamily: fonts.bold, fontWeight: 'normal' },
  },
}

/** Cabeçalho: título da tela em Bold itálico 22, sem sombra. */
export const headerOptions = {
  headerStyle: { backgroundColor: colors.superficie },
  headerTintColor: colors.marinho,
  headerTitleStyle: { fontFamily: type.titulo.fontFamily, fontSize: type.titulo.fontSize, color: colors.texto },
  headerShadowVisible: false,
} as const

/** Pilhas de telas (Atendimento, Dia do promotor...). */
export const stackOptions = {
  ...headerOptions,
  contentStyle: { backgroundColor: colors.fundo },
  headerBackTitle: 'Voltar',
} as const

/**
 * Altura da barra de abas sem a área do sistema: ícone (caixa de 28) e rótulo 13 (linha de 18) com 5 de folga em cima
 * e embaixo. A altura padrão do React Navigation (49) corta o rótulo nesse tamanho.
 */
const TAB_BAR_HEIGHT = 56
/** Letra do contador da aba: menor que o rótulo, para "99+" caber na largura do ícone */
const BADGE_FONT = 11

/** Barra de abas: fundo branco com borda superior; ativa em marinho, inativas em cinza; contador em pílula marinho. */
export function useTabsOptions() {
  const insets = useSafeAreaInsets()
  return {
    ...headerOptions,
    sceneStyle: { backgroundColor: colors.fundo },
    tabBarActiveTintColor: colors.marinho,
    tabBarInactiveTintColor: colors.neutro,
    tabBarStyle: {
      height: TAB_BAR_HEIGHT + insets.bottom,
      backgroundColor: colors.superficie,
      borderTopColor: colors.divisoria,
      borderTopWidth: borders.fina,
      elevation: 0,
      shadowOpacity: 0,
    },
    tabBarLabelStyle: { ...type.selo },
    // Letra menor que o rótulo para "99+" caber na largura do ícone
    tabBarBadgeStyle: { backgroundColor: colors.marinho, color: colors.branco, fontFamily: fonts.semibold, fontSize: BADGE_FONT, paddingHorizontal: space.xs - 1 },
  } as const
}
