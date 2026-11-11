import { Image } from 'expo-image'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { resolveUrl } from '@/lib/config'
import { colors, radius, sizes, space, type } from '@/lib/theme'

const TypingContext = createContext<(on: boolean) => void>(() => {})

/**
 * Enquanto `on` (ex.: escrevendo a justificativa), o visualizador encolhe a foto e leva o painel para o alto da tela,
 * para o teclado abrir abaixo da caixa de texto. No Android o Modal ocupa a tela toda (edge-to-edge) e não encolhe
 * quando o teclado abre, então sem isso o teclado cobria a caixa, que fica na parte de baixo.
 */
export function useViewerTyping(on: boolean) {
  const setTyping = useContext(TypingContext)
  useEffect(() => {
    setTyping(on)
    return () => setTyping(false)
  }, [on, setTyping])
}

/** Foto inteira sobre fundo preto, com a folha creme de dados e decisão embaixo. */
export function PhotoViewer({ url, visible, onClose, children }: { url: string | null; visible: boolean; onClose: () => void; children?: ReactNode }) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [typing, setTyping] = useState(false)
  const scroll = useRef<ScrollViewInstance>(null)
  // Ao começar a escrever, o painel volta ao topo: a caixa de texto fica logo abaixo da foto pequena
  useEffect(() => {
    if (typing) scroll.current?.scrollTo({ y: 0, animated: false })
  }, [typing])
  const thumb = Math.round(Math.min(150, height * 0.17))
  const photoStyle = typing ? { height: thumb } : { flex: 1 }
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <TypingContext.Provider value={setTyping}>
        <View style={{ flex: 1, backgroundColor: colors.preto, paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.sm }}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={{ minHeight: sizes.toque, minWidth: sizes.toque, justifyContent: 'center', paddingHorizontal: space.sm }}
            >
              <Text style={[type.botao, { color: colors.branco }]}>Fechar</Text>
            </Pressable>
          </View>
          {url ? <Image source={{ uri: resolveUrl(url) }} style={photoStyle} contentFit="contain" transition={150} /> : <View style={photoStyle} />}
          {children ? (
            <ScrollView
              ref={scroll}
              style={[{ backgroundColor: colors.fundo, borderTopLeftRadius: radius.folha, borderTopRightRadius: radius.folha }, typing ? { flex: 1 } : { maxHeight: '48%' }]}
              // Escrevendo, sobra espaço embaixo para rolar o painel por cima do teclado (o resto fica atrás dele)
              contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: typing ? Math.round(height * 0.5) : insets.bottom + space.lg }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : null}
        </View>
      </TypingContext.Provider>
    </Modal>
  )
}
