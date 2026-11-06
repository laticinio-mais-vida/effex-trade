import { Image } from 'expo-image'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { resolveUrl } from '@/lib/config'
import { colors, space } from '@/lib/theme'

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

/** Foto em tela cheia com área de informações/ações abaixo. */
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
        <View style={{ flex: 1, backgroundColor: '#0d1117', paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: space.md }}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Fechar</Text>
            </Pressable>
          </View>
          {url ? <Image source={{ uri: resolveUrl(url) }} style={photoStyle} contentFit="contain" transition={150} /> : <View style={photoStyle} />}
          {children ? (
            <ScrollView
              ref={scroll}
              style={[{ backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16 }, typing ? { flex: 1 } : { maxHeight: '48%' }]}
              // Escrevendo, sobra espaço embaixo para rolar o painel por cima do teclado (o resto fica atrás dele)
              contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: typing ? Math.round(height * 0.5) : insets.bottom + space.lg }}
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
