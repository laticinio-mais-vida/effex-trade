import { useEffect, useState } from 'react'
import { Banner, Card, Muted, SectionTitle } from '@/components/ui'
import { AccountScreen } from '@/features/AccountScreen'
import { useDay } from '@/features/promotor/DayContext'
import { flushQueue, isExpoGo, pendingPings } from '@/lib/tracking'

const modeLabels = { background: 'Ativo (segundo plano)', foreground: 'Ativo só com o app aberto', off: 'Desligado' }

export default function Conta() {
  const { tracking } = useDay()
  const [queued, setQueued] = useState(0)

  useEffect(() => {
    void flushQueue().then(() => pendingPings().then(setQueued))
  }, [])

  return (
    <AccountScreen
      extra={
        <>
          <SectionTitle>Rastreamento</SectionTitle>
          <Card>
            <Muted>Situação: {modeLabels[tracking.mode]}</Muted>
            {queued > 0 ? <Muted>{queued} posição(ões) aguardando internet para envio.</Muted> : null}
            {tracking.reason ? <Banner tone="warning" text={tracking.reason} /> : null}
            {isExpoGo ? <Banner tone="info" text="Você está usando o Expo Go (teste). No app instalado, a localização é enviada mesmo com a tela desligada." /> : null}
          </Card>
        </>
      }
    />
  )
}
