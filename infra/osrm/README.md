# Servidor de rotas (OSRM)

O OSRM é um programa de código aberto que calcula rotas pelas ruas usando o mapa do OpenStreetMap. Ele roda no nosso próprio servidor, ao lado da API: a API pergunta "qual a distância de carro deste cliente até aquele?" e ele responde em milissegundos, sem custo por consulta e sem mandar dados para fora.

## O que a EFFEX Trade usa dele

| Onde | O que muda |
|---|---|
| Relatório de execução | Km de deslocamento entre um cliente e o seguinte, por dia e no total do período, pelas ruas |
| Roteiros | Deslocamento estimado do dia e o botão "Usar sugestão de ordenação" passam a considerar as ruas e as mãos de direção |

É uma aproximação: o OSRM dá o caminho mais curto de carro entre os clientes, não o trajeto exato que o promotor fez.

**Sem o OSRM, tudo continua funcionando**, com as distâncias em linha reta. As telas dizem de onde veio a distância ("pelas ruas" ou "em linha reta"). Se o OSRM sair do ar, a API volta sozinha para linha reta e tenta de novo depois de 1 minuto.

## Requisitos

- Servidor Linux (pode ser o mesmo da API) com Docker e o plugin `docker compose`.
- `osmium-tool` e `wget` para preparar o mapa: `sudo apt install osmium-tool wget`.
- Memória: cerca de 8 GB livres na hora de preparar o mapa (dá para preparar em outra máquina e copiar a pasta `dados/atual`), e cerca de 2 a 4 GB para o servidor no ar. São estimativas para o recorte padrão (BA e ES); áreas maiores pedem mais.
- Disco: uns 5 GB.

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
