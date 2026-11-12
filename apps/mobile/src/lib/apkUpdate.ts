import * as Application from 'expo-application'
import { cacheDirectory, createDownloadResumable, deleteAsync, getContentUriAsync, getInfoAsync, makeDirectoryAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import { api } from './api'
import { resolveUrl } from './config'
import { updatesEnabled } from './updates'

/**
 * APK novo pelo próprio app. O código (telas, regras, textos) chega pelas atualizações de updates.ts; o que muda a parte
 * nativa precisa de APK novo. O deploy\gerar-apk.ps1 publica o APK no servidor (deploy\publicar-apk.ps1) e aqui o app
 * compara o build publicado com o instalado, baixa e abre o instalador do Android.
 * Fora da Play Store o Android sempre pede o toque em Instalar e, na primeira vez, que a pessoa permita instalar apps do
 * EFFEX Trade. O APK precisa ter a mesma chave de assinatura, senão o Android recusa ("App não instalado").
 */
export const apkUpdatesEnabled = updatesEnabled && Platform.OS === 'android'

export type ApkInfo = { build: number; version: string; size: number; md5: string; path: string; message: string | null }

type State = {
  /** Build publicado mais novo que o instalado (null: está em dia ou ainda não consultou) */
  info: ApkInfo | null
  phase: 'idle' | 'downloading' | 'installing'
  /** 0 a 1, durante o download */
  progress: number
  error: string | null
  /** O instalador abriu e a pessoa voltou sem instalar (cancelou ou foi permitir a instalação) */
  returned: boolean
}

const CHECK_EVERY_MS = 30 * 60_000
const DIR = `${cacheDirectory}apk/`
const installedBuild = Number(Application.nativeBuildVersion) || 0

let state: State = { info: null, phase: 'idle', progress: 0, error: null, returned: false }
const listeners = new Set<() => void>()
let lastCheckAt = 0
let checking: Promise<ApkInfo | null> | null = null

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useApkUpdate() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Consulta o servidor (no máximo a cada 30 min, salvo force). Devolve o APK novo, se houver. */
export function checkApk(force = false): Promise<ApkInfo | null> {
  if (!apkUpdatesEnabled) return Promise.resolve(null)
  if (!force && Date.now() - lastCheckAt < CHECK_EVERY_MS) return Promise.resolve(state.info)
  if (!checking) {
    checking = (async () => {
      try {
        lastCheckAt = Date.now()
        const latest = await api<ApkInfo | null>('/updates/apk/android', { auth: false, timeoutMs: 15_000 })
        const newer = latest && Number(latest.build) > installedBuild ? latest : null
        if (newer?.build !== state.info?.build) set({ error: null, returned: false })
        set({ info: newer })
        // Em dia: apaga o APK baixado antes (dezenas de MB), se ficou algum
        if (!newer) await deleteAsync(DIR, { idempotent: true }).catch(() => {})
        return newer
      } finally {
        checking = null
      }
    })()
  }
  return checking
}

/** Baixa o APK (se ainda não baixou) e abre o instalador do Android. Se instalar, o Android fecha o app. */
export async function installApk() {
  const info = state.info
  if (!info || state.phase !== 'idle') return
  set({ error: null, returned: false })
  try {
    const file = `${DIR}EFFEX-Trade-${info.build}.apk`
    if (!(await isComplete(file, info))) {
      await deleteAsync(DIR, { idempotent: true })
      await makeDirectoryAsync(DIR, { intermediates: true })
      set({ phase: 'downloading', progress: 0 })
      const download = createDownloadResumable(resolveUrl(info.path), file, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const progress = Math.min(1, totalBytesWritten / (totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : info.size))
        // Redesenha só a cada 1%
        if (Math.floor(progress * 100) !== Math.floor(state.progress * 100)) set({ progress })
      })
      const result = await download.downloadAsync()
      if (!result || result.status !== 200) throw new Error(`O servidor respondeu ${result?.status ?? 'sem dados'} ao baixar o app.`)
      if (!(await isComplete(file, info))) {
        await deleteAsync(file, { idempotent: true })
        throw new Error('O download veio incompleto. Tente de novo, de preferência no Wi-Fi.')
      }
    }
    set({ phase: 'installing' })
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: await getContentUriAsync(file),
      type: 'application/vnd.android.package-archive',
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: o instalador lê o arquivo do app
    })
    set({ returned: true })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    const network = /network|connect|resolve|unreachable|timed? ?out|host|socket/i.test(detail)
    set({ error: network ? 'Sem conexão para baixar o app. Verifique a internet e tente de novo.' : detail })
  } finally {
    set({ phase: 'idle', progress: 0 })
  }
}

async function isComplete(file: string, info: ApkInfo) {
  const found = await getInfoAsync(file, { md5: true })
  return found.exists && !found.isDirectory && found.size === info.size && !!info.md5 && found.md5?.toLowerCase() === info.md5.toLowerCase()
}

export function formatMb(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
