<#
Publica uma atualização do código do app no servidor (rota /updates da API). Ela chega sozinha aos celulares que têm um
APK com a mesma parte nativa.
Uso, no PowerShell, na pasta do projeto:
  powershell -ExecutionPolicy Bypass -File deploy\atualizar-app.ps1 -Mensagem "o que mudou"
  powershell -ExecutionPolicy Bypass -File deploy\atualizar-app.ps1 -Desfazer   (volta para a publicação anterior)

1. Confere o código do app (typecheck).
2. Confere se algum APK da pasta apk\ tem a mesma parte nativa (runtime). Se nenhum tiver, para: a atualização não
   chegaria a ninguém e é preciso um APK novo (deploy\gerar-apk.ps1). Com -Forcar, publica mesmo assim (ex.: o APK foi
   gerado em outro computador).
3. Monta o código (expo export) e envia ao servidor (ssh bi-vps), em /opt/effex-trade/updates.
Os celulares baixam ao abrir o app ou voltar para ele e aplicam na abertura seguinte, depois de 15 min fora do app numa
tela de abas, ou na hora pelo botão "Buscar atualização" da tela Conta. Guia: docs\app_android.md
#>
param([string]$Mensagem, [switch]$Desfazer, [switch]$Forcar)
. (Join-Path $PSScriptRoot 'app-comum.ps1')
if (-not $Desfazer -and -not $Mensagem) { throw 'Diga o que mudou: -Mensagem "texto".' }
if ($Desfazer -and -not $Mensagem) { $Mensagem = 'desfaz a publicação anterior' }

# O .env (IP do computador, para o Expo Go) não entra na atualização: a API de produção está em src/lib/config.ts
$env:EXPO_NO_DOTENV = '1'
Remove-Item Env:EXPO_PUBLIC_API_URL -ErrorAction SilentlyContinue
$tmp = Join-Path $env:TEMP 'effex-atualizacao'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
$pacote = Join-Path $tmp 'pacote'
$montar = Join-Path $PSScriptRoot 'montar-atualizacao.mjs'

Push-Location $mobile
try {
  if (-not (Test-Path 'node_modules')) { Rodar 'npm ci' { npm ci --no-audit --no-fund } }
  if (-not $Desfazer) {
    Write-Host '1/3 Conferindo o app...'
    Rodar 'typecheck' { npm run typecheck }
  }

  Write-Host '2/3 Conferindo a parte nativa (runtime)...'
  $runtime = RuntimeDe $mobile
  $apks = @(Get-ChildItem $pastaApk -Filter '*.apk' -ErrorAction SilentlyContinue | Where-Object { (RuntimeDoApk $_.FullName) -eq $runtime })
  if ($apks.Count -gt 0) {
    Write-Host "   Vale para $($apks[-1].Name) e os outros APKs com o runtime $runtime."
  } elseif ($Forcar) {
    Write-Host "   Nenhum APK da pasta apk\ tem o runtime $runtime; publicando assim mesmo (-Forcar)." -ForegroundColor Yellow
  } else {
    throw ("Nenhum APK da pasta apk\ tem esta parte nativa (runtime $runtime): a atualização não chegaria a ninguém. " +
      'Gere um APK novo (deploy\gerar-apk.ps1). Se o APK foi gerado em outro computador, use -Forcar.')
  }

  $remoto = "$pastaUpdates/android/$runtime"
  $entrada = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
  if ($Desfazer) {
    # Publicações do runtime no servidor, da mais antiga para a mais nova (M = atualização, D = volta ao APK)
    $listar = 'cd {0} 2>/dev/null && for d in [0-9]*; do [ -d $d ] || continue; if [ -f $d/manifest.json ]; then echo M $d; else echo D $d; fi; done; true' -f $remoto
    $publicacoes = @(ssh $servidor $listar | Where-Object { $_ -match '^[MD] \S+$' } | Sort-Object { $_.Substring(2) })
    if ($LASTEXITCODE -ne 0) { throw "falhou: lista das publicações em $servidor" }
    if ($publicacoes.Count -eq 0) { throw 'Não há publicação para desfazer neste runtime.' }
    $anterior = @($publicacoes | Select-Object -SkipLast 1 | Where-Object { $_.StartsWith('M ') }) | Select-Object -Last 1
    if ($anterior) {
      $nome = $anterior.Substring(2)
      Write-Host "3/3 Republicando a publicação anterior ($nome)..."
      Rodar 'download da publicação anterior' { scp "${servidor}:$remoto/$nome/manifest.json" (Join-Path $tmp 'anterior.json') }
      Rodar 'republicação' { node $montar republicar (Join-Path $tmp 'anterior.json') $pacote $Mensagem }
    } else {
      Write-Host '3/3 Sem publicação anterior: voltando todos para o código que veio no APK...'
      Rodar 'volta ao APK' { node $montar voltar-ao-apk $pacote $Mensagem }
    }
  } else {
    Write-Host '3/3 Montando e enviando a atualização...'
    Rodar 'expo export' { npx expo export --platform android --output-dir $pacote }
    Rodar 'manifesto' { node $montar montar $pacote $runtime $entrada $mobile $Mensagem }
  }
} finally {
  Pop-Location
}

$arquivo = Join-Path $tmp 'atualizacao.tgz'
Rodar 'pacote' { tar -czf $arquivo -C $pacote . }
Rodar 'pasta temporária no servidor' { ssh $servidor 'rm -rf /tmp/effex-atualizacao && mkdir -p /tmp/effex-atualizacao' }
Rodar 'envio' { scp $arquivo "${servidor}:/tmp/effex-atualizacao/" }
# Extrai numa pasta com ponto (a API ignora) e só então renomeia: o celular nunca vê uma publicação pela metade.
# O tar do Windows grava tudo como gravável por qualquer um: o chmod deixa só o dono (root) gravar, porque quem grava
# ali manda código para todos os celulares. Ficam as 15 publicações mais recentes de cada runtime.
$instalar = ('set -e; d={0}; mkdir -p $d/.{1}; tar -xzf /tmp/effex-atualizacao/atualizacao.tgz -C $d/.{1}; ' +
  'chmod -R u=rwX,go=rX $d; mv $d/.{1} $d/{1}; ls -1 $d | grep -v ''^[.]'' | sort | head -n -15 | while read v; do rm -rf $d/$v; done; ' +
  'rm -rf /tmp/effex-atualizacao') -f $remoto, $entrada
Rodar 'instalação no servidor' { ssh $servidor $instalar }
Remove-Item $tmp -Recurse -Force

Write-Host ''
Write-Host "Publicado: $entrada ($Mensagem)" -ForegroundColor Green
Write-Host 'Os celulares baixam ao abrir o app ou voltar para ele. Para aplicar na hora: Conta > Buscar atualização.'
