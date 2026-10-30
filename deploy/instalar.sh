#!/usr/bin/env bash
# Roda no VPS, chamado por deploy/publicar.ps1: instala o pacote enviado para /tmp/effex-publicar (api.tgz, web.tgz) e
# sobe os containers. Os segredos (api.env, banco.env), as fotos (uploads/), as atualizações do app (updates/) e o banco
# não são tocados.
set -euo pipefail

BASE=/opt/effex-trade
PACOTE=/tmp/effex-publicar

for f in api.env banco.env; do
  [ -f "$BASE/$f" ] || { echo "falta $BASE/$f (veja docs/publicacao_vps.md, Primeira instalação)"; exit 1; }
done

# Cópia do banco antes das migrações da versão nova (só se ele já existe)
if docker ps --format '{{.Names}}' | grep -qx effex_banco; then
  bash "$BASE/deploy/backup_banco.sh"
fi

# Código da API: pasta nova inteira, para não sobrar arquivo removido. A anterior fica em api.anterior.
rm -rf "$BASE/api.novo" "$BASE/api.anterior"
mkdir "$BASE/api.novo"
tar -xzf "$PACOTE/api.tgz" -C "$BASE/api.novo"
if [ -d "$BASE/api" ]; then mv "$BASE/api" "$BASE/api.anterior"; fi
mv "$BASE/api.novo" "$BASE/api"

# Painel: troca o conteúdo da pasta, e não a pasta, que está montada no container effex_web
mkdir -p "$BASE/web" "$BASE/uploads" "$BASE/updates"
find "$BASE/web" -mindepth 1 -delete
tar -xzf "$PACOTE/web.tgz" -C "$BASE/web"
chown -R 1000:1000 "$BASE/uploads"  # a API roda como o usuário node (1000)

cd "$BASE/deploy"
docker compose up -d --build
docker compose restart web  # relê o Caddyfile.web
docker image prune -f > /dev/null
rm -rf "$PACOTE"

echo "Aguardando a API..."
for _ in $(seq 1 60); do
  if docker exec effex_api node -e "fetch('http://localhost:3333/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2> /dev/null; then
    docker compose ps
    echo "EFFEX Trade no ar."
    exit 0
  fi
  sleep 2
done
docker compose ps
docker compose logs api --tail 40
echo "A API não respondeu em 2 minutos: veja o log acima."
exit 1
