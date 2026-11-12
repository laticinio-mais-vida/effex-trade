<#
Gera o APK Android do app (apps/mobile) neste computador, em apk\EFFEX-Trade-<versão>-<build>.apk, e publica no
servidor: os celulares com o app a partir do build 3 instalam pelo próprio app. Antes, uma vez por computador:
deploy\preparar-android.ps1 (Android SDK e chave de assinatura).
Uso, no PowerShell, na pasta do projeto:
  powershell -ExecutionPolicy Bypass -File deploy\gerar-apk.ps1 -Mensagem "o que mudou"
  powershell -ExecutionPolicy Bypass -File deploy\gerar-apk.ps1 -SemPublicar   (só gera; publique depois com publicar-apk.ps1)

1. Confere o código do app (typecheck) e calcula a parte nativa (runtime) que vai no APK.
2. Aumenta o número do build (android.versionCode no app.json): o Android só instala por cima um build maior.
3. Copia o app para C:\effex-apk (caminho curto) e monta o APK com o Gradle, assinado com a chave. O primeiro build
   baixa o resto do SDK e leva de 20 a 40 min; os seguintes, bem menos.
4. Confere a assinatura e o runtime do APK.
5. Publica no servidor (deploy\publicar-apk.ps1).
APK novo só é preciso quando a parte nativa muda; o resto vai por atualização (deploy\atualizar-app.ps1).
Guia: docs\app_android.md
#>
param([string]$Mensagem, [switch]$SemPublicar)
. (Join-Path $PSScriptRoot 'app-comum.ps1')

$jdk = PastaJdk
$chave = LerChave
if (-not (Test-Path (Join-Path $sdk 'licenses'))) { throw 'Android SDK não preparado: rode deploy\preparar-android.ps1.' }
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
# O .env (IP do computador, para o Expo Go) não entra no APK: a API de produção está em src/lib/config.ts
$env:EXPO_NO_DOTENV = '1'
Remove-Item Env:EXPO_PUBLIC_API_URL -ErrorAction SilentlyContinue

$appJson = Join-Path $mobile 'app.json'
$appJsonOriginal = [IO.File]::ReadAllText($appJson)
$copia = Join-Path $pastaBuild 'mobile'
try {
  Push-Location $mobile
  try {
    if (Test-Path 'android') { throw 'Apague a pasta apps\mobile\android: o build é feito na cópia em C:\effex-apk.' }
    if (-not (Test-Path 'node_modules')) { Rodar 'npm ci' { npm ci --no-audit --no-fund } }
    Write-Host '1/5 Conferindo o app...'
    Rodar 'typecheck' { npm run typecheck }
    $runtime = RuntimeDe $mobile
    Write-Host "   Parte nativa (runtime): $runtime"

    Write-Host '2/5 Aumentando o número do build...'
    $build = & node -e "const fs=require('fs'),j=JSON.parse(fs.readFileSync('app.json','utf8'));j.expo.android.versionCode=(j.expo.android.versionCode||0)+1;fs.writeFileSync('app.json',JSON.stringify(j,null,2)+'\n');console.log(j.expo.android.versionCode)"
    if ($LASTEXITCODE -ne 0) { throw 'falhou: número do build' }
    $versao = & node -p "require('./app.json').expo.version"
    Write-Host "   Versão $versao, build $build"
  } finally {
    Pop-Location
  }

  Write-Host "3/5 Montando o APK em $copia..."
  New-Item -ItemType Directory -Force $copia | Out-Null
  # /MIR apaga da cópia o que saiu do projeto; node_modules e android da cópia ficam (cache entre builds)
  robocopy $mobile $copia /MIR /XD node_modules android ios .expo dist web-build /XF .env .env.* *.jks /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "falhou: cópia para $copia (robocopy $LASTEXITCODE)" }
  Push-Location $copia
  try {
    $hashLock = (Get-FileHash 'package-lock.json').Hash
    $marca = 'node_modules\.effex-lock-hash'
    if (-not (Test-Path $marca) -or ([IO.File]::ReadAllText((Join-Path $copia $marca)).Trim() -ne $hashLock)) {
      Write-Host '   Instalando as dependências na cópia...'
      Rodar 'npm ci na cópia' { npm ci --no-audit --no-fund }
      [IO.File]::WriteAllText((Join-Path $copia $marca), $hashLock)
    }
    # A pasta android do build anterior pode ter caminhos acima de 260 caracteres: o Remove-Item não apaga, o Node apaga
    if (Test-Path 'android') { Rodar 'limpeza do build anterior' { node -e "require('fs').rmSync('android',{recursive:true,force:true})" } }
    $runtimeCopia = RuntimeDe $copia
    if ($runtimeCopia -ne $runtime) {
      throw "A parte nativa da cópia ($runtimeCopia) difere da do projeto ($runtime): rode 'npm ci' em apps\mobile e gere de novo."
    }
    $env:CI = '1'
    Rodar 'expo prebuild' { npx expo prebuild --platform android --no-install }
    Remove-Item Env:CI
    # O APK leva exatamente o runtime calculado no projeto, o mesmo que o atualizar-app.ps1 calcula
    $env:EXPO_UPDATES_FINGERPRINT_OVERRIDE = $runtime
    Push-Location 'android'
    try {
      # cmakeObjectPathMax=250: o Expo usa 1024, que só funciona com caminho longo habilitado no Windows (exige
      # administrador); com 250, o CMake encurta com hash os nomes dos arquivos do C++ e eles cabem nos 260 caracteres
      Rodar 'Gradle' {
        .\gradlew.bat assembleRelease --no-daemon '-Pexpo.android.cmakeObjectPathMax=250' `
          "-Pandroid.injected.signing.store.file=$($chave.arquivo)" "-Pandroid.injected.signing.store.password=$($chave.senha)" `
          "-Pandroid.injected.signing.key.alias=$($chave.alias)" "-Pandroid.injected.signing.key.password=$($chave.senha)"
      }
    } finally {
      Pop-Location
    }
    $saida = Join-Path $copia 'android\app\build\outputs\apk\release\app-release.apk'

    Write-Host '4/5 Conferindo o APK...'
    $dados = ConferirApk $saida $chave
    if ($dados.Runtime -ne $runtime) { throw "O APK saiu com outro runtime ($($dados.Runtime), esperado $runtime): as atualizações não chegariam a ele." }
    if ($dados.Build -ne [int]$build) { throw "O APK saiu com o build $($dados.Build), esperado $build." }

    New-Item -ItemType Directory -Force $pastaApk | Out-Null
    $apk = Join-Path $pastaApk ('EFFEX-Trade-{0}-{1}.apk' -f $versao, $build)
    Copy-Item $saida $apk -Force
  } finally {
    Pop-Location
  }
} catch {
  # O APK não saiu: o número do build volta
  [IO.File]::WriteAllText($appJson, $appJsonOriginal)
  throw
} finally {
  Remove-Item Env:EXPO_UPDATES_FINGERPRINT_OVERRIDE -ErrorAction SilentlyContinue
}

$mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
Write-Host ''
Write-Host "APK pronto: $apk ($mb MB)" -ForegroundColor Green
Write-Host "Versão $versao, build $build, runtime $runtime, assinado com a chave $($chave.sha256)"
Write-Host ''

# Fora do try: se a publicação falhar, o APK já existe e o número do build fica (publique de novo com publicar-apk.ps1)
if ($SemPublicar) {
  Write-Host 'Não publicado (-SemPublicar). Para publicar: deploy\publicar-apk.ps1' -ForegroundColor Yellow
} else {
  Write-Host '5/5 Publicando no servidor...'
  & (Join-Path $PSScriptRoot 'publicar-apk.ps1') -Apk $apk -Mensagem $Mensagem
}
Write-Host 'Passo a passo da instalação e mensagem para os usuários: docs\app_android.md'
