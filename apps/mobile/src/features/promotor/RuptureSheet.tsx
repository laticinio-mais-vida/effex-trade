import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, View } from 'react-native'
import { Banner, Button, Muted, Sheet, styles } from '@/components/ui'
import { api, ApiError, errorMessage } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { colors, space } from '@/lib/theme'
import type { RuptureInfo, Visit } from '@/lib/types'

/**
 * Confirmação de ruptura: produtos que o cliente compra (mix) e que não foram marcados em
 * nenhuma foto de depois. O promotor confirma que essa diferença é ruptura.
 */
export function RuptureSheet({ visible, visitId, onClose, onConfirmed }: { visible: boolean; visitId: string; onClose: () => void; onConfirmed: (visit: Visit) => void }) {
  const [info, setInfo] = useState<RuptureInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setInfo(await api<RuptureInfo>(`/promotor/visits/${visitId}/rupture`))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [visitId])

  useEffect(() => {
    if (!visible) return
    setInfo(null)
    void load()
  }, [visible, load])

  async function confirm() {
    if (!info) return
    setBusy(true)
    try {
      const visit = await api<Visit>(`/promotor/visits/${visitId}/rupture/confirm`, { body: { productIds: info.missing.map((p) => p.id) } })
      onConfirmed(visit)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LISTA_MUDOU') {
        await load()
        Alert.alert('A lista mudou', 'Os produtos das fotos de depois foram alterados. Confira a lista de novo antes de confirmar.')
      } else {
        Alert.alert('Ruptura não confirmada', errorMessage(e))
      }
    } finally {
      setBusy(false)
    }
  }

  const missing = info?.missing ?? []
  return (
    <Sheet visible={visible} title="Confirmar ruptura" onClose={onClose}>
      {error ? <Banner tone="danger" text={error} /> : null}
      {!info && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {info ? (
        <>
          {info.confirmedAt ? <Banner tone="success" text={`Ruptura confirmada às ${formatTime(info.confirmedAt)}.`} /> : null}
          {!info.hasMix ? (
            <Text style={styles.text}>O mix deste cliente (produtos que ele compra) ainda não foi cadastrado, então não há o que contrastar. Confirme para seguir.</Text>
          ) : missing.length === 0 ? (
            <Text style={styles.text}>Todos os {info.mixSize} produtos que o cliente compra aparecem nas fotos de depois. Nenhuma ruptura.</Text>
          ) : (
            <>
              <Text style={styles.text}>
                {missing.length} de {info.mixSize} produtos que o cliente compra não aparecem nas fotos de depois:
              </Text>
              <View style={{ gap: space.xs }}>
                {missing.map((p) => (
                  <View key={p.id} style={[styles.option, { borderColor: colors.danger, backgroundColor: colors.dangerSoft }]}>
                    <Text style={styles.optionText}>{p.name}</Text>
                    <Muted>{p.code}</Muted>
                  </View>
                ))}
              </View>
              <Muted>
                Se algum estiver na gôndola, feche esta tela, toque na foto de depois em que ele aparece e use "Editar produtos" para marcá-lo.
              </Muted>
            </>
          )}
          {info.hasMix ? <Muted>Marcados nas fotos de depois: {info.identified.length} produto(s).</Muted> : null}
          <Button
            title={missing.length > 0 ? 'Confirmo que são ruptura' : 'Confirmar'}
            variant={missing.length > 0 ? 'danger' : 'primary'}
            loading={busy}
            onPress={confirm}
          />
        </>
      ) : null}
    </Sheet>
  )
}
