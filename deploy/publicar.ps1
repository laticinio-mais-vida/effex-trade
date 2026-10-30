<#
Publica a versão do computador no VPS (https://effextrade.maisvida.cloud).
Uso, no PowerShell, na pasta do projeto:  powershell -ExecutionPolicy Bypass -File deploy\publicar.ps1

1. Monta o painel (apps/admin, com a API em /api).
2. Empacota a API (sem node_modules) e o painel.
3. Envia ao servidor (ssh bi-vps, configurado em ~/.ssh/config) e roda deploy/instalar.sh lá, que faz a cópia
   de segurança do banco, troca o código e sobe os containers.
Segredos (api.env, banco.env), fotos e banco ficam como estão no servidor.
#>
param([string]$Servidor = 'bi-vps')
$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP 'effex-publicar'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null

function Rodar([string]$descricao, [scriptblock]$comando) {
  & $comando
  if ($LASTEXITCODE -ne 0) { throw "falhou: $descricao" }
}

Write-Host '1/4 Montando o painel...'
Push-Location (Join-Path $raiz 'apps\admin')
try { Rodar 'build do painel' { npm run build } } finally { Pop-Location }

Write-Host '2/4 Empacotando...'
$api = Join-Path $raiz 'apps\api'
Rodar 'pacote da API' { tar -czf "$tmp\api.tgz" --exclude=src/generated -C $api src prisma scripts package.json package-lock.json prisma.config.ts tsconfig.json Dockerfile .dockerignore }
Rodar 'pacote do painel' { tar -czf "$tmp\web.tgz" -C (Join-Path $raiz 'apps\admin\dist') . }
Rodar 'pacote do deploy' { tar -czf "$tmp\deploy.tgz" -C (Join-Path $raiz 'deploy') docker-compose.yml Caddyfile.web caddy-bloco.txt backup_banco.sh instalar.sh }

Write-Host "3/4 Enviando para $Servidor..."
Rodar 'pasta temporária no servidor' { ssh $Servidor 'rm -rf /tmp/effex-publicar && mkdir -p /tmp/effex-publicar /opt/effex-trade/deploy' }
Rodar 'envio' { scp "$tmp\api.tgz" "$tmp\web.tgz" "$tmp\deploy.tgz" "${Servidor}:/tmp/effex-publicar/" }

Write-Host '4/4 Instalando no servidor...'
Rodar 'instalação' { ssh $Servidor 'tar -xzf /tmp/effex-publicar/deploy.tgz -C /opt/effex-trade/deploy && bash /opt/effex-trade/deploy/instalar.sh' }

Remove-Item $tmp -Recurse -Force
Write-Host 'Publicado: https://effextrade.maisvida.cloud'
