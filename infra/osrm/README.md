# Servidor de rotas (OSRM)

O OSRM é um programa de código aberto que calcula rotas pelas ruas usando o mapa do OpenStreetMap. Ele roda no nosso próprio servidor, ao lado da API: a API pergunta "qual a distância de carro deste cliente até aquele?" e ele responde em milissegundos, sem custo por consulta e sem mandar dados para fora.

## O que a EFFEX Trade usa dele

| Onde | O que muda |
|---|---|
| Relatório de execução: km pela rota | Km de deslocamento entre um cliente e o seguinte, por dia e no total do período, pelas ruas |
| Relatório de execução: km percorrido (GPS) | Os pontos que o celular registrou no trecho são encaixados nas ruas (serviço `match`, "map matching"), e o km é o desse caminho |
| Roteiros | Deslocamento estimado do dia e o botão "Usar sugestão de ordenação" passam a considerar as ruas e as mãos de direção |

O km pela rota é uma aproximação: o caminho mais curto de carro entre os clientes. O trajeto feito é o km percorrido (GPS).

**Sem o OSRM, tudo continua funcionando**, com as distâncias em linha reta. As telas dizem de onde veio a distância ("pelas ruas" ou "em linha reta"). Se o OSRM sair do ar, a API volta sozinha para linha reta e tenta de novo depois de 1 minuto. O km percorrido (GPS) é a exceção: como é calculado uma vez e gravado, em produção o dia espera o OSRM voltar, em vez de gravar um número em linha reta.

**No VPS do EFFEX** o OSRM roda como o serviço `osrm` (container `effex_osrm`) do `deploy/docker-compose.yml`, com o mapa em `/opt/effex-trade/osrm` e `OSRM_URL=http://osrm:5000`: siga [docs/publicacao_vps.md](../../docs/publicacao_vps.md#servidor-de-rotas-osrm). O `docker-compose.yml` desta pasta é para rodar o OSRM em outro servidor.

## Requisitos

- Servidor Linux (pode ser o mesmo da API) com Docker e o plugin `docker compose`.
- `osmium-tool` e `wget` para preparar o mapa: `sudo apt install osmium-tool wget`.
- Memória: o preparo do recorte padrão (BA e ES) chegou a 10 GB (out/2026; dá para preparar em outra máquina e copiar a pasta `dados/atual`), e o servidor no ar usa uns 2,3 GB. Áreas maiores pedem mais. O preparo usa no máximo 2 processadores e 12 GB, para não pesar nos outros sistemas do servidor (mude com `CPUS=4 MEMORIA=14g bash preparar-mapa.sh`).
- Disco: uns 7 GB (2,5 GB de mapas baixados e 3,3 GB de rotas, mais a versão anterior durante a troca).

## Instalação

```bash
cd infra/osrm
bash preparar-mapa.sh          # baixa o mapa, recorta BA + ES e gera as rotas (15 a 60 min)
docker compose up -d           # sobe o servidor na porta 5000, só para a própria máquina
```

Para conferir, uma rota entre dois pontos de Salvador (deve responder `"code":"Ok"` com a distância em metros):

```bash
curl "http://127.0.0.1:5000/route/v1/driving/-38.5014,-12.9714;-38.4567,-12.9990?overview=false"
```

Depois, no `.env` da API:

```
OSRM_URL="http://127.0.0.1:5000"
```

e reinicie a API. Se a API também rodar em Docker, na mesma rede do compose, use `http://osrm:5000`.

## Atualizar o mapa (uma vez por mês)

Ruas novas e mudanças de mão só entram quando o mapa é preparado de novo:

```bash
cd infra/osrm && bash preparar-mapa.sh && docker compose restart osrm
```

Dá para deixar automático no `crontab` (todo dia 1º, às 3h):

```
0 3 1 * * cd /caminho/do/projeto/infra/osrm && bash preparar-mapa.sh && docker compose restart osrm
```

No VPS do EFFEX o reinício é `docker restart effex_osrm` (o cron que está lá fica em [docs/publicacao_vps.md](../../docs/publicacao_vps.md#servidor-de-rotas-osrm)).

## Mudar a área de atuação

O recorte padrão cobre a Bahia e o Espírito Santo com folga. Se a operação crescer para outros estados, mude as regiões e o recorte (oeste,sul,leste,norte em graus) ao rodar o script:

```bash
REGIOES="nordeste sudeste centro-oeste" RECORTE="-53.1,-22.9,-34.7,-2.7" bash preparar-mapa.sh
```

As regiões disponíveis estão em https://download.geofabrik.de/south-america/brazil.html. Cliente fora do recorte não quebra nada: o trecho até ele fica em linha reta.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Relatório mostra "em linha reta" | Conferir `OSRM_URL` no `.env` da API, se o container está no ar (`docker compose ps`) e o `curl` acima. O log da API mostra `[osrm] sem resposta` quando não alcança o servidor. |
| `osrm-extract` morre sem mensagem | Falta de memória: prepare o mapa numa máquina com mais RAM e copie `dados/atual` para o servidor. |
| Distância estranha num cliente | Coordenada do cliente fora da rua ou errada no cadastro: o OSRM liga o ponto à rua mais próxima. Corrija o local em Clientes. |
| Km percorrido (GPS) "a calcular" por muito tempo | O dia espera o OSRM: confira os itens da primeira linha. O log da API mostra `[km-gps]` se um dia der erro. |
