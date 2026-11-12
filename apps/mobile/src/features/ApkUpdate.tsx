import { usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, Text } from 'react-native'
import { Banner, Button, Muted, Sheet, styles } from '@/components/ui'
import { apkUpdatesEnabled, checkApk, formatMb, installApk, useApkUpdate } from '@/lib/apkUpdate'
import { SAFE_ROUTES } from '@/lib/updates'

/** "Depois" esconde o aviso deste build por 4 horas (o app do promotor fica aberto por dias). */
const SNOOZE_MS = 4 * 60 * 60_000
let snoozed: { build: number; until: number } | null = null

/** Botão de instalar, com o andamento do download e o que fazer se o Android não instalou. Na folha e na tela Conta. */
export function ApkInstallActions() {
  const { info, phase, progress, error, returned } = useApkUpdate()
  if (!info) return null
  return (
    <>
      {phase === 'downloading' ? (
        <Muted>
          Baixando… {Math.round(progress * 100)}% de {formatMb(info.size)}
        </Muted>
      ) : null}
      {phase === 'installing' ? <Muted>Na tela do Android, toque em Instalar (ou Atualizar).</Muted> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      {returned && !error ? (
        <Banner
          tone="warning"
          text="O app novo não foi instalado. Se o Android pediu permissão, ative Permitir desta fonte, volte e toque em Atualizar agora de novo."
        />
      ) : null}
      <Button title="Atualizar agora" onPress={() => void installApk()} loading={phase !== 'idle'} />
    </>
  )
}

/** No layout raiz: consulta ao abrir e ao voltar para o app, e avisa numa folha quando há APK novo (só nas abas e no login). */
export function ApkUpdatePrompt() {
  const apk = useApkUpdate()
  const pathname = usePathname()
  const [, redraw] = useState(0)

  useEffect(() => {
    if (!apkUpdatesEnabled) return
    void checkApk(true).catch(() => {})
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkApk().catch(() => {})
    })
    return () => sub.remove()
  }, [])

  const { info } = apk
  const isSnoozed = !!info && snoozed?.build === info.build && Date.now() < snoozed.until
  const visible = !!info && !isSnoozed && SAFE_ROUTES.has(pathname)
  if (!info) return null

  return (
    <Sheet
      visible={visible}
      title="Nova versão do app"
      onClose={() => {
        snoozed = { build: info.build, until: Date.now() + SNOOZE_MS }
        redraw((n) => n + 1)
      }}
    >
      <Text style={styles.text}>
        A versão {info.version} (build {info.build}) está pronta para instalar. São {formatMb(info.size)}: se puder, use o Wi-Fi.
      </Text>
      {info.message ? <Muted>{info.message}</Muted> : null}
      <Muted>Seu login e seus dados continuam. Depois de instalar, toque em Abrir.</Muted>
      <ApkInstallActions />
    </Sheet>
  )
}
