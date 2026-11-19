import { cacheDirectory, createDownloadResumable } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { getToken } from './api'
import { loadApiUrl } from './config'

/** Baixa um arquivo da API (com o login) e abre o menu de compartilhar do aparelho (WhatsApp, e-mail, salvar...). */
export async function downloadAndShare(path: string, filename: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este aparelho não tem o compartilhamento de arquivos disponível.')
  const base = await loadApiUrl()
  const token = await getToken()
  const target = `${cacheDirectory}${filename}`
  const result = await createDownloadResumable(`${base}${path}`, target, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).downloadAsync()
  if (!result || result.status !== 200) throw new Error('Não foi possível gerar o arquivo. Tente de novo.')
  await Sharing.shareAsync(result.uri, { mimeType, dialogTitle: 'Enviar relatório' })
}
