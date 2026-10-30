#!/usr/bin/env bash
# Cópia de segurança diária do EFFEX Trade: o banco (pg_dump do container effex_banco, um arquivo por dia, 14 dias) e
# as fotos (espelho de /opt/effex-trade/uploads; as fotos não mudam depois de gravadas, então só as novas são copiadas e
# as apagadas continuam na cópia). Fica fora de /opt/effex-trade, que a publicação troca. No cron (crontab -e), 03:45 UTC
# (00:45 em Brasília, depois da cópia do BI):
#   45 3 * * * bash /opt/effex-trade/deploy/backup_banco.sh >> /var/log/effex-backup.log 2>&1
# Restaurar o banco (troca o conteúdo pelo da cópia):
#   docker exec -i effex_banco pg_restore -U effex -d effex --clean --if-exists < /opt/backups/effex-trade/effex-AAAA-MM-DD.dump
# Isto protege contra erro no sistema ou no banco, não contra perder o servidor: baixe de vez em quando uma cópia para
# fora dele (docs/publicacao_vps.md, "Cópia de segurança").
set -euo pipefail

DESTINO=/opt/backups/effex-trade
DIAS=14

mkdir -p "$DESTINO/fotos"
chmod 700 "$DESTINO"
arquivo="$DESTINO/effex-$(date +%F).dump"
docker exec effex_banco pg_dump -U effex -d effex -Fc > "$arquivo.tmp"
mv "$arquivo.tmp" "$arquivo"
find "$DESTINO" -maxdepth 1 -name 'effex-*.dump' -mtime +"$DIAS" -delete
rsync -a /opt/effex-trade/uploads/ "$DESTINO/fotos/"
echo "$(date '+%F %T') cópia em $arquivo ($(du -h "$arquivo" | cut -f1)); fotos: $(du -sh "$DESTINO/fotos" | cut -f1)"
