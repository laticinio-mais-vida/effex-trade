// Monta os arquivos de uma publicação do app para a rota /updates da API (apps/api/src/routes/updates.ts), no
// protocolo expo-updates v1. Usado por deploy/atualizar-app.ps1:
//   node montar-atualizacao.mjs montar <pasta do expo export> <runtime> <entrada> <pasta do app> <mensagem>
//   node montar-atualizacao.mjs republicar <manifest.json anterior> <pasta de saída> <mensagem>
//   node montar-atualizacao.mjs voltar-ao-apk <pasta de saída> <mensagem>
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const [modo, ...args] = process.argv.slice(2)
const agora = new Date().toISOString()
const tipos = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json' }

function salvar(pasta, nome, dados) {
  mkdirSync(pasta, { recursive: true })
  writeFileSync(join(pasta, nome), JSON.stringify(dados))
}

/** Anotação para quem olhar a pasta no servidor (a API não lê). */
function anotar(pasta, mensagem) {
  salvar(pasta, 'publicacao.json', { mensagem, publicadaEm: agora, por: process.env.USERNAME ?? null })
}

if (modo === 'montar') {
  const [dist, runtimeVersion, entrada, app, mensagem] = args
  const arquivos = JSON.parse(readFileSync(join(dist, 'metadata.json'), 'utf8')).fileMetadata.android
  // URLs relativas ao endereço do manifesto (.../api/updates/manifest): o app resolve para .../api/updates/files/...
  const base = `files/android/${runtimeVersion}/${entrada}/`
  const asset = (caminho, ext) => {
    const dados = readFileSync(join(dist, caminho))
    return {
      hash: createHash('sha256').update(dados).digest('base64url'),
      key: createHash('md5').update(dados).digest('hex'),
      fileExtension: ext ? `.${ext}` : '.bundle',
      contentType: ext ? (tipos[ext] ?? 'application/octet-stream') : 'application/javascript',
      url: base + caminho.replaceAll('\\', '/'),
    }
  }
  // A mesma configuração pública que vai embutida no APK: o app a lê em Constants.expoConfig
  const { getConfig } = createRequire(join(app, 'package.json'))('expo/config')
  const { exp } = getConfig(app, { isPublicConfig: true, skipSDKVersionRequirement: true })
  salvar(dist, 'manifest.json', {
    id: randomUUID(),
    createdAt: agora,
    runtimeVersion,
    launchAsset: asset(arquivos.bundle),
    assets: arquivos.assets.map((a) => asset(a.path, a.ext)),
    metadata: {},
    extra: { expoClient: exp },
  })
  anotar(dist, mensagem)
} else if (modo === 'republicar') {
  // Os mesmos arquivos da publicação anterior (as URLs continuam apontando para a pasta dela), com id e data novos: o
  // app só troca para uma atualização mais nova que a que está rodando
  const [anterior, saida, mensagem] = args
  salvar(saida, 'manifest.json', { ...JSON.parse(readFileSync(anterior, 'utf8')), id: randomUUID(), createdAt: agora })
  anotar(saida, mensagem)
} else if (modo === 'voltar-ao-apk') {
  const [saida, mensagem] = args
  salvar(saida, 'directive.json', { type: 'rollBackToEmbedded', parameters: { commitTime: agora } })
  anotar(saida, mensagem)
} else {
  console.error('uso: node montar-atualizacao.mjs montar|republicar|voltar-ao-apk ...')
  process.exit(1)
}
