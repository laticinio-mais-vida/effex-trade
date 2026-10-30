<#
Prepara este computador para gerar o APK do app. Uma vez por computador; rodar de novo não estraga nada.
Uso, no PowerShell, na pasta do projeto:  powershell -ExecutionPolicy Bypass -File deploy\preparar-android.ps1

1. Confere o Java (JDK 17 ou mais novo).
2. Instala as ferramentas do Android SDK em %LOCALAPPDATA%\Android\Sdk (sem Android Studio) e aceita as licenças. O resto
   (plataforma, NDK, CMake) o primeiro build baixa sozinho. Com o build, tudo ocupa uns 8 GB.
3. Cria a chave de assinatura do app em Documentos\EFFEX Trade - chave do app, se ainda não existir.
   GUARDE UMA CÓPIA DESSA PASTA FORA DESTE COMPUTADOR: sem ela nenhum APK novo instala por cima do antigo.
Guia: docs\app_android.md
#>
. (Join-Path $PSScriptRoot 'app-comum.ps1')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host '1/3 Java...'
$jdk = PastaJdk
$env:JAVA_HOME = $jdk
Write-Host "   $jdk"

Write-Host '2/3 Android SDK...'
$livre = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
if ($livre -lt 10) { Write-Host "   Atenção: só $livre GB livres no C:. O SDK e o build ocupam uns 8 GB." -ForegroundColor Yellow }
$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) {
  [xml]$repositorio = (Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/repository2-3.xml').Content
  $pacote = $repositorio.SelectNodes('//remotePackage') | Where-Object { $_.path -eq 'cmdline-tools;latest' } | Select-Object -First 1
  $arquivo = $pacote.archives.archive | Where-Object { $_.'host-os' -eq 'windows' } | Select-Object -First 1
  $sha1 = $arquivo.complete.checksum
  if ($sha1 -is [Xml.XmlElement]) { $sha1 = $sha1.'#text' }
  $tmp = Join-Path $env:TEMP 'effex-android-sdk'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory $tmp | Out-Null
  $zip = Join-Path $tmp 'cmdline-tools.zip'
  Write-Host "   Baixando $($arquivo.complete.url)..."
  Rodar 'download das ferramentas do SDK' { curl.exe --fail --location --silent --show-error --output $zip "https://dl.google.com/android/repository/$($arquivo.complete.url)" }
  if ((Get-FileHash $zip -Algorithm SHA1).Hash -ne $sha1) { throw 'O download veio corrompido (SHA-1 diferente do publicado pelo Google). Rode de novo.' }
  Rodar 'extração das ferramentas do SDK' { tar -xf $zip -C $tmp }
  New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
  Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $sdk 'cmdline-tools\latest')
  Remove-Item $tmp -Recurse -Force
}
$env:ANDROID_HOME = $sdk
Write-Host '   Aceitando as licenças...'
((1..40 | ForEach-Object { 'y' }) -join "`n") | & $sdkmanager --licenses | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'falhou: licenças do Android SDK' }
Write-Host '   Instalando o platform-tools (adb)...'
Rodar 'platform-tools' { & $sdkmanager --install platform-tools | Out-Null }

Write-Host '3/3 Chave de assinatura...'
$propriedades = Join-Path $pastaChave 'chave.properties'
$jks = Join-Path $pastaChave 'effex-trade.jks'
if (Test-Path $propriedades) {
  Write-Host "   Já existe em $pastaChave (não foi mexida)."
} else {
  if (Test-Path $jks) { throw "Existe $jks sem o chave.properties ao lado. Restaure a cópia de segurança completa da pasta; não crie outra chave." }
  New-Item -ItemType Directory -Force $pastaChave | Out-Null
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $senha = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
  $keytool = Join-Path $jdk 'bin\keytool.exe'
  Rodar 'criação da chave' { & $keytool -genkeypair -keystore $jks -storetype PKCS12 -alias effex-trade -keyalg RSA -keysize 2048 -validity 36500 -dname 'CN=EFFEX Trade, C=BR' -storepass $senha -keypass $senha -noprompt }
  $lista = & $keytool -list -v -keystore $jks -storepass $senha -alias effex-trade
  $sha256 = ($lista | Select-String 'SHA256:\s*([0-9A-F:]+)' | Select-Object -First 1).Matches[0].Groups[1].Value
  if (-not $sha256) { throw 'Não consegui ler o SHA-256 da chave criada.' }
  $texto = @(
    "# Chave de assinatura do app EFFEX Trade (pacote com.effex.trade), criada por deploy\preparar-android.ps1 em $(Get-Date -Format 'dd/MM/yyyy').",
    '# GUARDE UMA CÓPIA DESTA PASTA (este arquivo e o effex-trade.jks) FORA DESTE COMPUTADOR.',
    '# Sem ela nenhum APK novo instala por cima do antigo, e o registro do app no Google (2027) fica impossível.',
    'arquivo=effex-trade.jks',
    'alias=effex-trade',
    "senha=$senha",
    "sha256=$sha256"
  )
  [IO.File]::WriteAllLines($propriedades, $texto)
  Write-Host "   Chave criada em $pastaChave" -ForegroundColor Green
  Write-Host "   SHA-256: $sha256"
}

Write-Host ''
Write-Host "GUARDE UMA CÓPIA DA PASTA $pastaChave FORA DESTE COMPUTADOR (pendrive ou cofre de senhas)." -ForegroundColor Yellow
Write-Host 'Pronto. Para gerar o APK: powershell -ExecutionPolicy Bypass -File deploy\gerar-apk.ps1'
