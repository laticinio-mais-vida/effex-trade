# Caminhos e funções dos scripts do app Android (preparar-android.ps1, gerar-apk.ps1, atualizar-app.ps1).
# Carregado por eles com:  . (Join-Path $PSScriptRoot 'app-comum.ps1')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$raiz = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $raiz 'apps\mobile'
$pastaApk = Join-Path $raiz 'apk'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
# O build roda numa cópia em caminho curto: no caminho do projeto, os arquivos que o NDK gera passam do limite de 260
# caracteres do Windows
$pastaBuild = 'C:\effex-apk'
# Chave de assinatura, fora do projeto. Sem ela nenhum APK novo instala por cima do antigo
$pastaChave = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'EFFEX Trade - chave do app'
# Servidor das atualizações (o mesmo do deploy\publicar.ps1) e a pasta montada na API (deploy/docker-compose.yml)
$servidor = 'bi-vps'
$pastaUpdates = '/opt/effex-trade/updates'
# APKs que o app instala sozinho (deploy\publicar-apk.ps1; rota /updates/apk/android da API)
$pastaApkServidor = "$pastaUpdates/apk/android"
$apiPublica = 'https://effextrade.maisvida.cloud/api'

function Rodar([string]$descricao, [scriptblock]$comando) {
  & $comando
  if ($LASTEXITCODE -ne 0) { throw "falhou: $descricao" }
}

# JDK 17 ou mais novo: o 17 (o recomendado pelo React Native), se houver; senão o mais novo
function PastaJdk {
  $candidatos = @()
  if ($env:JAVA_HOME) { $candidatos += $env:JAVA_HOME }
  foreach ($base in 'C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft', 'C:\Program Files\Zulu') {
    if (Test-Path $base) { $candidatos += @(Get-ChildItem $base -Directory | ForEach-Object { $_.FullName }) }
  }
  $jdks = foreach ($pasta in $candidatos) {
    $release = Join-Path $pasta 'release'
    if ((Test-Path (Join-Path $pasta 'bin\javac.exe')) -and (Test-Path $release)) {
      $versao = [int](Select-String -Path $release -Pattern '^JAVA_VERSION="(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value
      if ($versao -ge 17) { [pscustomobject]@{ Pasta = $pasta; Versao = $versao } }
    }
  }
  $escolhido = @($jdks | Sort-Object { $_.Versao -ne 17 }, { -$_.Versao }) | Select-Object -First 1
  if (-not $escolhido) { throw 'Java (JDK 17 ou mais novo) não encontrado. Instale o JDK 17 (https://adoptium.net) e rode de novo.' }
  $escolhido.Pasta
}

# chave.properties (criado pelo preparar-android.ps1): arquivo, alias, senha e sha256 da chave
function LerChave {
  $propriedades = Join-Path $pastaChave 'chave.properties'
  if (-not (Test-Path $propriedades)) {
    throw "Chave de assinatura não encontrada em $pastaChave. Restaure a cópia de segurança dessa pasta ou, se o app nunca foi distribuído, rode deploy\preparar-android.ps1."
  }
  $chave = @{}
  foreach ($linha in [IO.File]::ReadAllLines($propriedades)) {
    if ($linha -match '^\s*([a-z0-9]+)\s*=\s*(.*?)\s*$') { $chave[$Matches[1]] = $Matches[2] }
  }
  $chave.arquivo = Join-Path $pastaChave $chave.arquivo
  if (-not (Test-Path $chave.arquivo)) { throw "Falta o arquivo da chave: $($chave.arquivo)" }
  $chave
}

# Parte nativa (runtime) do app numa pasta: uma atualização só chega aos APKs com o mesmo valor
function RuntimeDe([string]$pasta) {
  Push-Location $pasta
  try {
    $saida = & npx expo-updates runtimeversion:resolve --platform android
    if ($LASTEXITCODE -ne 0) { throw 'falhou: cálculo da parte nativa (runtime)' }
    $linha = @($saida) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
    ($linha | ConvertFrom-Json).runtimeVersion
  } finally {
    Pop-Location
  }
}

# Runtime gravado no APK (assets/fingerprint, que o expo-updates lê no celular)
function RuntimeDoApk([string]$apk) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($apk)
  try {
    $entrada = $zip.GetEntry('assets/fingerprint')
    if (-not $entrada) { return $null }
    $leitor = New-Object IO.StreamReader($entrada.Open())
    try { $leitor.ReadToEnd().Trim() } finally { $leitor.Dispose() }
  } finally {
    $zip.Dispose()
  }
}

# build-tools mais novo do Android SDK (apksigner e aapt2)
function PastaBuildTools {
  $pasta = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } | Select-Object -Last 1
  if (-not $pasta) { throw 'Android SDK sem build-tools: rode deploy\preparar-android.ps1.' }
  $pasta.FullName
}

# Confere um APK: pacote do app, assinado com a chave do app (senão o Android não instala por cima) e com o runtime
# gravado. Devolve versão, build e runtime lidos do próprio APK.
function ConferirApk([string]$apk, $chave) {
  $ferramentas = PastaBuildTools
  $certificados = & (Join-Path $ferramentas 'apksigner.bat') verify --print-certs $apk
  if ($LASTEXITCODE -ne 0) { throw "O APK $apk está com a assinatura inválida." }
  $shaApk = ($certificados | Select-String 'certificate SHA-256 digest: ([0-9a-f]+)' | Select-Object -First 1).Matches[0].Groups[1].Value
  if ($shaApk -ne ($chave.sha256 -replace ':', '').ToLower()) { throw "O APK $apk foi assinado com outra chave." }
  $saida = @(& (Join-Path $ferramentas 'aapt2.exe') dump badging $apk)
  if ($LASTEXITCODE -ne 0) { throw "falhou: leitura do APK $apk (aapt2)" }
  $pacote = [string]($saida | Where-Object { $_ -like 'package:*' } | Select-Object -First 1)
  if ($pacote -notmatch "^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'") {
    throw "Não consegui ler o pacote e a versão do APK $apk."
  }
  if ($Matches[1] -ne 'com.effex.trade') { throw "O APK $apk é de outro app ($($Matches[1]))." }
  $build = [int]$Matches[2]
  $versao = $Matches[3]
  $runtime = RuntimeDoApk $apk
  if (-not $runtime) { throw "O APK $apk não tem o runtime gravado (assets/fingerprint)." }
  [pscustomobject]@{ Versao = $versao; Build = $build; Runtime = $runtime }
}
