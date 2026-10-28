import { Image } from 'expo-image'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { resolveUrl } from '@/lib/config'
import { colors, space } from '@/lib/theme'

/** Foto em tela cheia com área de informações/ações abaixo. */
export function PhotoViewer({ url, visible, onClose, children }: { url: string | null; visible: boolean; onClose: () => void; children?: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0d1117', paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: space.md }}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Fechar</Text>
          </Pressable>
        </View>
        {url ? <Image source={{ uri: resolveUrl(url) }} style={{ flex: 1 }} contentFit="contain" transition={150} /> : <View style={{ flex: 1 }} />}
        {children ? (
          <ScrollView
            style={{ maxHeight: '48%', backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
            contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  )
}
