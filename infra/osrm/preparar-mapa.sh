#!/usr/bin/env bash
# Baixa o mapa do OpenStreetMap (Geofabrik), recorta a área de atuação e gera os arquivos do OSRM.
# Rode na primeira instalação e depois uma vez por mês (ruas novas, mãos de direção). Leva de 15 a 60 minutos.
# O servidor que já está no ar continua atendendo enquanto o mapa novo é preparado.
set -euo pipefail
cd "$(dirname "$0")"

IMAGEM="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.10.0-debian}"
# Regiões do Brasil no Geofabrik que cobrem a operação: a Bahia fica no Nordeste e o Espírito Santo no Sudeste.
REGIOES="${REGIOES:-nordeste sudeste}"
# Recorte em graus (oeste,sul,leste,norte). O padrão cobre BA e ES com folga (entra um pedaço de MG, SE e PE).
RECORTE="${RECORTE:--46.7,-21.4,-37.2,-8.4}"
# Limites dos containers de preparo, para não pesar nos outros sistemas do servidor. O recorte padrão chegou a 10 GB no
# osrm-extract (out/2026); com menos memória ele é interrompido e o mapa em uso continua o mesmo.
CPUS="${CPUS:-2}"
MEMORIA="${MEMORIA:-12g}"

for programa in docker osmium wget; do
  command -v "$programa" >/dev/null || { echo "Falta instalar: $programa (ver README.md)"; exit 1; }
done

mkdir -p dados/baixados
rm -rf dados/novo
mkdir -p dados/novo

arquivos=()
for regiao in $REGIOES; do
  echo ">> Baixando $regiao"
  wget -q --show-progress -N -P dados/baixados "https://download.geofabrik.de/south-america/brazil/$regiao-latest.osm.pbf"
  arquivos+=("dados/baixados/$regiao-latest.osm.pbf")
done

echo ">> Juntando as regiões e recortando a área de atuação"
osmium merge "${arquivos[@]}" -o dados/baixados/regioes.osm.pbf --overwrite
osmium extract --bbox "$RECORTE" dados/baixados/regioes.osm.pbf -o dados/novo/mapa.osm.pbf --overwrite

echo ">> Gerando as rotas (perfil de carro)"
# Sem -t (terminal): roda também pelo cron
osrm() { docker run --rm --cpus "$CPUS" --memory "$MEMORIA" -v "$PWD/dados/novo:/data" "$IMAGEM" "$@"; }
osrm osrm-extract -p /opt/car.lua /data/mapa.osm.pbf
osrm osrm-partition /data/mapa.osrm
osrm osrm-customize /data/mapa.osrm
rm dados/novo/mapa.osm.pbf

# Troca o mapa em uso pelo novo e guarda o anterior até a próxima atualização
rm -rf dados/anterior
[ -d dados/atual ] && mv dados/atual dados/anterior
mv dados/novo dados/atual

echo ">> Mapa pronto em dados/atual."
echo "   Primeira vez: docker compose up -d"
echo "   Atualização:  docker compose restart osrm   (no VPS do EFFEX: docker restart effex_osrm)"
