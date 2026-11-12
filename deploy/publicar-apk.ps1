<#
Publica um APK no servidor, em /opt/effex-trade/updates/apk/android/<build>. Os celulares com o app a partir do build 3
mostram "Nova versão do app" e instalam pelo próprio app; quem instala do zero baixa pelo link fixo
https://effextrade.maisvida.cloud/api/updates/apk/android/baixar. O deploy\gerar-apk.ps1 chama este script no fim.
Uso, no PowerShell, na pasta do projeto:
  powershell -ExecutionPolicy Bypass -File deploy\publicar-apk.ps1                (o APK de build maior da pasta apk\)
  powershell -ExecutionPolicy Bypass -File deploy\publicar-apk.ps1 -Apk apk\EFFEX-Trade-0.1.0-3.apk -Mensagem "o que mudou"

1. Confere o APK: assinado com a chave do app, com o runtime gravado; versão e build vêm do próprio APK.
2. Não troca um build que já está no servidor com outro arquivo (o app guarda o download pelo número do build).
3. Envia para uma pasta com ponto (a API ignora) e só então renomeia: o celular nunca vê um APK pela metade.
   Ficam no servidor os 3 builds mais recentes.
Guia: docs\app_android.md
#>
param([string]$Apk, [string]$Mensagem)
. (Join-Path $PSScriptRoot 'app-comum.ps1')

if (-not $Apk) {
  $Apk = Get-ChildItem $pastaApk -Filter 'EFFEX-Trade-*.apk' -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.BaseName -replace '^.*-(\d+)$', '$1') } | Select-Object -Last 1 -ExpandProperty FullName
  if (-not $Apk) { throw "Nenhum APK em $pastaApk. Gere com deploy\gerar-apk.ps1." }
}
$Apk = (Resolve-Path $Apk).Path

Write-Host "1/3 Conferindo $(Split-Path $Apk -Leaf)..."
$chave = LerChave
$dados = ConferirApk $Apk $chave
$build = $dados.Build
$arquivo = 'EFFEX-Trade-{0}-{1}.apk' -f $dados.Versao, $build
$sha256 = (Get-FileHash $Apk -Algorithm SHA256).Hash.ToLower()
Write-Host "   Versão $($dados.Versao), build $build, runtime $($dados.Runtime)"

$remoto = "$pastaApkServidor/$build"
$existente = @(ssh $servidor "if [ -d $remoto ]; then sha256sum $remoto/*.apk | cut -d' ' -f1; fi")
if ($LASTEXITCODE -ne 0) { throw "falhou: consulta do build $build em $servidor" }
if ($existente.Count -gt 0) {
  if ($existente[0] -eq $sha256) {
    Write-Host "O build $build já está publicado com este mesmo arquivo." -ForegroundColor Green
    return
  }
  throw "O build $build já está publicado no servidor com outro arquivo. Gere um APK novo (deploy\gerar-apk.ps1 sobe o número do build)."
}

Write-Host '2/3 Enviando...'
$tmp = Join-Path $env:TEMP 'effex-publicar-apk'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
$info = [ordered]@{
  build = $build
  version = $dados.Versao
  runtime = $dados.Runtime
  file = $arquivo
  size = (Get-Item $Apk).Length
  md5 = (Get-FileHash $Apk -Algorithm MD5).Hash.ToLower()
  sha256 = $sha256
  publishedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  message = $(if ($Mensagem) { $Mensagem } else { $null })
}
[IO.File]::WriteAllText((Join-Path $tmp 'info.json'), ($info | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
Copy-Item $Apk (Join-Path $tmp $arquivo)
Rodar 'pasta temporária no servidor' { ssh $servidor 'rm -rf /tmp/effex-apk && mkdir -p /tmp/effex-apk' }
Rodar 'envio' { scp (Join-Path $tmp $arquivo) (Join-Path $tmp 'info.json') "${servidor}:/tmp/effex-apk/" }

Write-Host '3/3 Instalando no servidor...'
# O chmod deixa só o dono (root) gravar: quem grava ali manda app para todos os celulares
$instalar = ('set -e; d={0}; b={1}; mkdir -p $d; rm -rf $d/.$b; mkdir $d/.$b; mv /tmp/effex-apk/* $d/.$b/; ' +
  'chmod -R u=rwX,go=rX $d/.$b; mv $d/.$b $d/$b; ' +
  'ls -1 $d | grep -E ''^[0-9]+$'' | sort -n | head -n -3 | while read v; do rm -rf $d/$v; done; rm -rf /tmp/effex-apk') -f $pastaApkServidor, $build
Rodar 'instalação no servidor' { ssh $servidor $instalar }
Remove-Item $tmp -Recurse -Force

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$publicado = Invoke-RestMethod "$apiPublica/updates/apk/android" -TimeoutSec 30
if ([int]$publicado.build -ne $build) {
  Write-Host "Atenção: o servidor está oferecendo o build $($publicado.build), não o $build." -ForegroundColor Yellow
} else {
  Write-Host ''
  Write-Host "Publicado: build $build ($([math]::Round($info.size / 1MB, 1)) MB)" -ForegroundColor Green
}
Write-Host 'Os celulares com o app a partir do build 3 mostram "Nova versão do app" ao abrir ou voltar para o app.'
Write-Host "Para instalar do zero: $apiPublica/updates/apk/android/baixar"
