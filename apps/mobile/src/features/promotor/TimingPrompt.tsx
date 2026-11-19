import { useCallback, useState } from 'react'
import { Alert, Text } from 'react-native'
import { Button, Muted, PromptSheet, Sheet, styles } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { describeFlag, useTimingFlags } from '@/lib/timing'
import type { TimingFlag } from '@/lib/types'

/**
 * Aviso de tempo acima do normal, logo depois do check-out (ou da chegada no cliente seguinte). Fica na raiz do módulo do
 * promotor para continuar na tela mesmo depois de voltar da tela do atendimento. O promotor pode justificar na hora (o
 * supervisor vê) ou deixar para depois, na aba "Meu tempo".
 */
export function TimingPrompt() {
  const [queue, setQueue] = useState<TimingFlag[]>([])
  const [justifying, setJustifying] = useState(false)
  useTimingFlags(useCallback((flags) => setQueue((q) => [...q, ...flags]), []))
  const current = queue[0]
  const next = () => {
    setJustifying(false)
    setQueue((q) => q.slice(1))
  }

  return (
    <>
      <Sheet visible={!!current && !justifying} title="Tempo acima do normal" onClose={next}>
        {current ? <Text style={styles.text}>{describeFlag(current)}</Text> : null}
        <Muted>Se teve um motivo (ex.: esperando o gerente), explique: o seu supervisor vai ver. Você também pode fazer isso depois, na aba Meu tempo.</Muted>
        <Button title="Justificar" onPress={() => setJustifying(true)} />
        <Button title="Depois" variant="secondary" onPress={next} />
      </Sheet>
      <PromptSheet
        visible={!!current && justifying}
        title="Explique o tempo"
        message={current ? describeFlag(current) : undefined}
        placeholder="Ex.: esperei o gerente conferir o pedido"
        minLength={5}
        confirmLabel="Enviar"
        onConfirm={async (text) => {
          try {
            await api(`/promotor/time-flags/${current!.id}/justify`, { body: { text } })
            next()
          } catch (e) {
            Alert.alert('Não foi possível enviar', errorMessage(e))
          }
        }}
        onClose={() => setJustifying(false)}
      />
    </>
  )
}
