import { usePathname } from 'expo-router'
import * as Updates from 'expo-updates'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { colors } from './theme'

/**
 * Atualização do código pelo EAS Update (canal production), só no app instalado: no Expo Go e em desenvolvimento
 * fica desligada. Na abertura do app o expo-updates consulta e baixa sozinho e aplica na abertura seguinte
 * (checkAutomatically ON_LOAD). Como o serviço de localização mantém o app do promotor aberto por dias, o
 * <AutoUpdates /> também baixa ao voltar para o app e aplica num momento seguro; o botão da tela Conta aplica na hora.
 */
export const updatesEnabled = Updates.isEnabled && !__DEV__

const CHECK_EVERY_MS = 30 * 60_000
/** Tempo mínimo em segundo plano para reiniciar sozinho: a volta da câmera leva segundos. */
const APPLY_AFTER_BACKGROUND_MS = 15 * 60_000
/** Abas e login, onde reiniciar não perde nada. Visita, encerramento e pedidos ficam de fora (foto em envio, texto digitado). */
const SAFE_ROUTES = new Set([
  '/',
  '/login',
  '/promotor',
  '/promotor/liberacoes',
  '/promotor/conta',
  '/vendedor',
  '/vendedor/conta',
  '/supervisor',
  '/supervisor/fotos',
  '/supervisor/vendedores',
  '/supervisor/equipe',
  '/supervisor/conta',
])

let lastCheckAt = Date.now() // a abertura do app já consultou
let downloading: Promise<boolean> | null = null

/** Consulta e baixa, sem aplicar. true = há atualização pronta para aplicar. */
export function downloadUpdate(): Promise<boolean> {
  if (!updatesEnabled) return Promise.resolve(false)
  if (!downloading) {
    downloading = (async () => {
      try {
        lastCheckAt = Date.now()
        const check = await Updates.checkForUpdateAsync()
        if (!check.isAvailable && !check.isRollBackToEmbedded) return false
        const result = await Updates.fetchUpdateAsync()
        return result.isNew || result.isRollBackToEmbedded
      } finally {
        downloading = null
      }
    })()
  }
  return downloading
}

/** Reinicia o app com a atualização baixada. */
export function applyUpdate() {
  return Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: colors.bg, fade: true, spinner: { enabled: true, color: colors.primary } } })
}

/** No layout raiz: baixa ao voltar para o app e só reinicia sozinho depois de um tempo fora, numa tela segura. */
export function AutoUpdates() {
  const { isUpdatePending } = Updates.useUpdates()
  const pathname = usePathname()
  const current = useRef({ isUpdatePending, pathname })
  current.current = { isUpdatePending, pathname }

  useEffect(() => {
    if (!updatesEnabled) return
    let backgroundSince: number | null = null
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundSince = Date.now()
        return
      }
      if (state !== 'active') return
      const away = backgroundSince === null ? 0 : Date.now() - backgroundSince
      backgroundSince = null
      const { isUpdatePending: pending, pathname: path } = current.current
      if (pending && away >= APPLY_AFTER_BACKGROUND_MS && SAFE_ROUTES.has(path)) void applyUpdate().catch(() => {})
      else if (Date.now() - lastCheckAt >= CHECK_EVERY_MS) void downloadUpdate().catch(() => {})
    })
    return () => sub.remove()
  }, [])

  return null
}
