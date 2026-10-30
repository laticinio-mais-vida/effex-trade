import * as Application from 'expo-application'
import * as Updates from 'expo-updates'
import { useState } from 'react'
import { Banner, Button, Card, Muted, SectionTitle } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { applyUpdate, downloadUpdate, updatesEnabled } from '@/lib/updates'

/** Tela Conta: versão instalada, código em uso e o botão que busca e aplica a atualização na hora. */
export function AppVersionCard() {
  const { currentlyRunning, isUpdatePending, isChecking, isDownloading } = Updates.useUpdates()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function update() {
    setBusy(true)
    setMsg(null)
    try {
      if (!isUpdatePending && !(await downloadUpdate())) {
        setMsg({ ok: true, text: 'Você já está na versão mais recente.' })
        return
      }
      await applyUpdate()
    } catch {
      setMsg({ ok: false, text: 'Não foi possível buscar a atualização. Verifique a internet e tente de novo.' })
    } finally {
      setBusy(false)
    }
  }

  if (!updatesEnabled) {
    return (
      <>
        <SectionTitle>Versão do app</SectionTitle>
        <Card>
          <Muted>Versão de teste (Expo Go): as atualizações só funcionam no app instalado (APK).</Muted>
        </Card>
      </>
    )
  }

  const running = currentlyRunning.isEmbeddedLaunch
    ? 'o que veio no APK'
    : `atualização de ${formatDateTime(currentlyRunning.createdAt?.toISOString())} (${currentlyRunning.updateId?.slice(0, 8)})`

  return (
    <>
      <SectionTitle>Versão do app</SectionTitle>
      <Card>
        <Muted>
          App {Application.nativeApplicationVersion} (build {Application.nativeBuildVersion}) · código: {running}
        </Muted>
        {currentlyRunning.isEmergencyLaunch ? <Banner tone="warning" text="A última atualização não abriu; o app voltou para o código que veio no APK." /> : null}
        {msg ? <Banner tone={msg.ok ? 'success' : 'danger'} text={msg.text} /> : null}
        <Button
          title={isUpdatePending ? 'Reiniciar e aplicar atualização' : 'Buscar atualização'}
          variant="secondary"
          onPress={update}
          loading={busy || isChecking || isDownloading}
        />
      </Card>
    </>
  )
}
