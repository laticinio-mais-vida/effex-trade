import { Image } from 'expo-image'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { resolveUrl } from '@/lib/config'
import { borders, colors, elevated, radius, sizes, space, type } from '@/lib/theme'

type ViewerState = {
  typing: boolean
  setTyping: (on: boolean) => void
  scroll: RefObject<ScrollViewInstance | null>
  /** O painel monta a folha (ViewerInfo) e o rodapé (ViewerFooter) por conta própria */
  slots: boolean
}

const ViewerContext = createContext<ViewerState>({ typing: false, setTyping: () => {}, scroll: { current: null }, slots: false })

/**
 * Enquanto `on` (ex.: escrevendo a justificativa), o visualizador encolhe a foto e leva o painel para o alto da tela,
 * para o teclado abrir abaixo da caixa de texto. No Android o Modal ocupa a tela toda (edge-to-edge) e não encolhe
 * quando o teclado abre, então sem isso o teclado cobria a caixa, que fica na parte de baixo.
 */
export function useViewerTyping(on: boolean) {
  const { setTyping } = useContext(ViewerContext)
  useEffect(() => {
    setTyping(on)
    return () => setTyping(false)
  }, [on, setTyping])
}

/** Folha creme com os dados da foto (rola). Escrevendo, ocupa a tela e volta ao topo. */
export function ViewerInfo({ children }: { children: ReactNode }) {
  const { typing, scroll, slots } = useContext(ViewerContext)
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  // Ao começar a escrever, o painel volta ao topo: a caixa de texto fica logo abaixo da foto pequena
  useEffect(() => {
    if (typing) scroll.current?.scrollTo({ y: 0, animated: false })
  }, [typing, scroll])
  return (
    <ScrollView
      ref={scroll}
      style={[
        { backgroundColor: colors.fundo, borderTopLeftRadius: radius.folha, borderTopRightRadius: radius.folha },
        typing ? { flex: 1 } : { maxHeight: slots ? '38%' : '48%' },
      ]}
      // Escrevendo, sobra espaço embaixo para rolar o painel por cima do teclado (o resto fica atrás dele)
      contentContainerStyle={{
        padding: space.lg,
        gap: space.sm,
        paddingBottom: typing ? Math.round(height * 0.5) : slots ? space.lg : insets.bottom + space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  )
}

/** Botões de decisão fixos no rodapé. Somem enquanto se escreve: aí os botões ficam junto da caixa, no alto. */
export function ViewerFooter({ children }: { children: ReactNode }) {
  const { typing } = useContext(ViewerContext)
  const insets = useSafeAreaInsets()
  if (typing) return null
  return (
    <View
      style={{
        gap: space.sm,
        backgroundColor: colors.fundo,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        paddingBottom: insets.bottom + space.md,
        borderTopWidth: borders.fina,
        borderTopColor: colors.divisoria,
        ...elevated,
      }}
    >
      {children}
    </View>
  )
}

/**
 * Foto inteira sobre fundo preto, com a folha creme de dados embaixo. Com `slots`, o painel usa ViewerInfo e
 * ViewerFooter (foto maior e decisão no rodapé fixo); sem, o conteúdo vai inteiro na folha.
 */
export function PhotoViewer({
  url,
  visible,
  onClose,
  children,
  slots,
}: {
  url: string | null
  visible: boolean
  onClose: () => void
  children?: ReactNode
  slots?: boolean
}) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [typing, setTyping] = useState(false)
  const scroll = useRef<ScrollViewInstance>(null)
  const thumb = Math.round(Math.min(150, height * 0.17))
  const photoStyle = typing ? { height: thumb } : { flex: 1 }
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <ViewerContext.Provider value={{ typing, setTyping, scroll, slots: !!slots }}>
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
          {children ? slots ? children : <ViewerInfo>{children}</ViewerInfo> : null}
        </View>
      </ViewerContext.Provider>
    </Modal>
  )
}
