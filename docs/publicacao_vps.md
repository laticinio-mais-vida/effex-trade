# EFFEX Trade na internet: effextrade.maisvida.cloud

O painel fica em **https://effextrade.maisvida.cloud**. O app dos promotores fala com a API em
**https://effextrade.maisvida.cloud/api**. A primeira parte deste guia é a rotina de quem cuida dos dados. A
[parte técnica](#parte-técnica-para-quem-cuida-do-servidor) é para quem mexe no servidor.

## Clientes vindos do ERP

Os clientes vêm da **cópia do banco do ERP**, a mesma que o BI Mais Vida lê
(`C:\Users\Micro\Documents\banco de dados\LATICINIOMAISVIDALTDA.GDB`).

1. Depois que a cópia do banco chegar ao computador, dê dois cliques em:

   `C:\Users\Micro\Desktop\EFFEX - TRADE\sync\sincronizar-clientes.bat`

2. A janela mostra o resumo, por exemplo:

   ```
   11073 clientes no ERP (3141 ativos). Cópia do banco de 29/10/2026 às 08:58.
   Sincronização concluída:
     12 novos, 3 alterados, 1 inativados, 0 reativados
   ```

3. Aperte uma tecla para fechar. Não precisa deixar nada aberto.

O que acontece no site:

| No ERP | No EFFEX Trade |
|---|---|
| Cliente novo | Aparece em Clientes, sem localização |
| Nome fantasia, razão social, cidade, UF ou situação mudou | Muda igual |
| Cliente inativado (ou apagado) | Fica inativo: sai dos roteiros dos próximos dias |
| Cliente reativado | Volta a ficar ativo |
| Latitude e longitude (campos LATITUDADE e LONGITUDE do cadastro do cliente; sem elas, as de entrega) | Viram a localização do cliente, enquanto ninguém a corrigir no EFFEX |

**Localização:** vem do ERP, mas pode ser corrigida no painel, em Clientes (no mapa, um por um, ou pela planilha, vários
de uma vez). **Depois de corrigida no EFFEX, a sincronização não a muda mais**, mesmo que o ERP mande outra. O resumo da
janela mostra quantas ficaram assim ("localizações editadas no painel mantidas"). Importar a planilha baixada sem mudar
a coordenada de um cliente não conta como correção. Coordenada vazia no ERP nunca apaga a localização que o cliente já
tem. No painel, a lista e a planilha baixada mostram de onde veio cada localização (ERP ou painel).

Coordenadas genéricas do ERP (vários clientes no mesmo ponto, como o centro de um distrito) entram como estão: corrija
essas no painel, senão o check-in do promotor nesses clientes cai fora da cerca.

Nome, razão social, cidade, UF e situação dos clientes do ERP ficam travados no painel: para mudar, mude no ERP e
sincronize de novo. Também não dá para cadastrar cliente pelo painel: cadastre no ERP. A sincronização nunca mexe nos
roteiros, no mix ou nas visitas.

O painel mostra em Clientes: "Atualizado do ERP em … (cópia do banco de …)". Cada execução também fica anotada em
`sync\sincronizar.log`.

### Se a sincronização não funcionar

A janela mostra `NÃO SINCRONIZOU:` e o motivo.

| Mensagem | O que fazer |
|---|---|
| `falha ao ler o banco` | O serviço *Firebird Server - DefaultInstance* está parado, ou a cópia ainda está sendo gravada. Espere a cópia terminar e rode de novo. |
| `sem conexão com https://effextrade.maisvida.cloud/api` | Internet do computador ou site fora do ar. Abra o site no navegador. |
| `o relógio do computador que envia está mais de 15 minutos diferente` | Acerte a hora do Windows: Configurações › Hora e idioma › **Sincronizar agora**. |
| `Assinatura inválida` | A chave do `sync\config.ini` não é a mesma do servidor (veja [Trocar a chave](#trocar-a-chave-da-sincronização)). |
| `... clientes ativos do ERP ficariam inativos de uma vez` | Trava contra cópia do banco quebrada: mais de 30% dos clientes sumiriam. Confira a cópia. Se estiver certo, rode no Prompt de Comando, na pasta `sync`: `sincronizar-clientes.bat --forcar`. |
| `falta a senha do banco` / `falta a chave` | O `sync\config.ini` está incompleto (modelo em `sync\config.exemplo.ini`). |

---

## Parte técnica (para quem cuida do servidor)

### Onde está cada coisa

O servidor é o mesmo do BI (`187.127.54.201`, Ubuntu 24.04, `ssh bi-vps` do computador da empresa, com a chave
`~/.ssh/id_ed25519_vps`). Ele também roda o app de promotoria (`estoque.maisvida.cloud`), o BI, a Evolution API e o
RAG. **Não mude fuso, firewall nem portas.**

| O quê | Onde |
|---|---|
| Tudo do EFFEX | `/opt/effex-trade` |
| Código da API (a versão anterior fica em `api.anterior`) | `/opt/effex-trade/api` |
| Painel montado | `/opt/effex-trade/web` |
| Fotos | `/opt/effex-trade/uploads` |
| Atualizações do app (enviadas por `deploy\atualizar-app.ps1`, veja [app_android.md](app_android.md)) | `/opt/effex-trade/updates` |
| Segredos da API: `DATABASE_URL`, `JWT_SECRET`, `SYNC_KEY`, `CORS_ORIGIN`, `TRUST_PROXY`, `TZ_APP` (e `OSRM_URL`, o servidor de rotas) | `/opt/effex-trade/api.env` |
| Servidor de rotas: mapa (`dados/atual`) e `preparar-mapa.sh` (veja [Servidor de rotas](#servidor-de-rotas-osrm)) | `/opt/effex-trade/osrm` |
| Senha do banco | `/opt/effex-trade/banco.env` |
| `docker-compose.yml`, scripts | `/opt/effex-trade/deploy` |
| Containers | `effex_api` (Node 24, até 512 MB), `effex_web` (Caddy com o painel, 64 MB), `effex_banco` (PostgreSQL 18, 256 MB, volume `effex-trade_effex_banco_dados`), `effex_osrm` (servidor de rotas, até 6 GB) |
| HTTPS | bloco no fim de `/opt/app-promotoria/Caddyfile` (container `estoque_caddy`) |
| Cópias de segurança | `/opt/backups/effex-trade` |

Nenhum container do EFFEX abre porta para a internet. O Caddy do app de promotoria recebe `effextrade.maisvida.cloud`,
manda `/api/*` (sem o `/api`) para `effex_api:3333` e o resto para `effex_web:80`. O banco e o servidor de rotas só são
vistos pela API.

### Comandos do dia a dia

```bash
cd /opt/effex-trade/deploy
docker compose ps                     # está rodando?
docker compose logs api --tail 50     # últimas mensagens (sincronizações, erros)
docker compose logs osrm --tail 20    # servidor de rotas
docker compose restart api            # reiniciar (ex.: depois de mudar o api.env)
docker stats --no-stream              # memória
```

### Publicar uma versão nova

No computador, no PowerShell, na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\publicar.ps1
```

Ele monta o painel, envia a API e o painel e roda `deploy/instalar.sh` no servidor, que:

1. faz a cópia de segurança do banco;
2. troca o código (o anterior fica em `/opt/effex-trade/api.anterior`);
3. refaz a imagem e sobe os containers (as migrações do banco rodam sozinhas na subida da API);
4. espera a API responder.

`api.env`, `banco.env`, fotos e banco não são tocados. **Nunca rode `npm run db:seed` nem `db:reset` no servidor**: eles
apagam tudo (o seed se recusa a rodar em produção).

Para voltar à versão anterior do código:

```bash
cd /opt/effex-trade && rm -rf api && mv api.anterior api && cd deploy && docker compose up -d --build
```

Se a versão nova mudou o banco (migração nova em `apps/api/prisma/migrations`), restaure também a cópia do banco feita
antes da publicação (abaixo).

### Primeira instalação (já feita em 29/10/2026)

1. No servidor, criar a pasta e os segredos (senhas em hexadecimal, que não precisam de escape na `DATABASE_URL`):

   ```bash
   mkdir -p /opt/effex-trade/{deploy,web,uploads} && cd /opt/effex-trade
   SENHA=$(openssl rand -hex 24)
   echo "POSTGRES_PASSWORD=$SENHA" > banco.env
   cat > api.env <<EOF
   DATABASE_URL=postgresql://effex:$SENHA@effex_banco:5432/effex
   JWT_SECRET=$(openssl rand -hex 32)
   SYNC_KEY=$(openssl rand -hex 32)
   CORS_ORIGIN=https://effextrade.maisvida.cloud
   TRUST_PROXY=true
   TZ_APP=America/Bahia
   OSRM_URL=http://osrm:5000
   EOF
   chmod 600 api.env banco.env
   ```

2. Copiar a `SYNC_KEY` para a linha `chave =` do `sync\config.ini` do computador da empresa.
3. Publicar (`deploy\publicar.ps1`).
4. Criar o administrador (pede a senha duas vezes; também cria os motivos de justificativa padrão). Já conectado no
   servidor (prompt `root@srv1911183`):

   ```bash
   docker exec -it effex_api npm run criar-admin
   ```

   Ou direto do PowerShell do computador da empresa (o apelido `bi-vps` só existe nele, em `~/.ssh/config`):

   ```powershell
   ssh -t bi-vps docker exec -it effex_api npm run criar-admin
   ```

   O mesmo comando troca a senha de um login que já existe (`npm run criar-admin -- LOGIN`).
5. DNS: registro **A** `effextrade` → `187.127.54.201` na zona `maisvida.cloud`.
6. HTTPS: acrescentar o bloco de `deploy/caddy-bloco.txt` no fim do Caddyfile (veja [HTTPS](#https-caddy)).
7. Cópia de segurança diária (veja abaixo).

### HTTPS (Caddy)

O Caddyfile é do app de promotoria e cuida do HTTPS de todos os sistemas do servidor. Cuidados:

- Faça uma cópia antes: `cp -p /opt/app-promotoria/Caddyfile /opt/app-promotoria/Caddyfile.bak-$(date +%Y%m%d%H%M%S)`.
- O arquivo é montado sozinho no container: acrescente **no fim, sem trocar o arquivo** (editores que gravam um arquivo
  novo fazem o container continuar vendo o antigo):
  `cat /opt/effex-trade/deploy/caddy-bloco.txt >> /opt/app-promotoria/Caddyfile`.
  Confira com `docker exec estoque_caddy tail -20 /etc/caddy/Caddyfile`.
- Valide e só então recarregue (os outros sites não saem do ar):

  ```bash
  docker exec estoque_caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && \
  docker exec estoque_caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  ```

- Os blocos do EFFEX, do BI, da Evolution API e do RAG não estão no git do app de promotoria: se alguém refizer o
  Caddyfile a partir de lá, eles somem.

### Servidor de rotas (OSRM)

Dá os km pelas ruas do relatório, a sugestão de ordenação dos roteiros e o encaixe nas ruas do km percorrido (GPS)
([infra/osrm/README.md](../infra/osrm/README.md)). Roda no próprio VPS como o container `effex_osrm` (serviço `osrm` do
`docker-compose.yml`), só na rede `interno`: nenhuma porta aberta, só a API o alcança, em `http://osrm:5000`. O mapa
(OpenStreetMap, recorte de BA + ES) fica em `/opt/effex-trade/osrm/dados`; o que está em uso é `dados/atual`.

Instalação (já feita em 30/10/2026):

1. Do computador, copie o script: `scp infra\osrm\preparar-mapa.sh bi-vps:/opt/effex-trade/osrm/`.
2. No servidor, instale o `osmium-tool` (`apt install osmium-tool`) e prepare o mapa. Levou 18 minutos (o download é
   de 1,3 GB) e usa no máximo 2 processadores e 12 GB de memória (o pico foi de 10 GB):
   `cd /opt/effex-trade/osrm && bash preparar-mapa.sh`.
3. Coloque `OSRM_URL=http://osrm:5000` no `api.env` e rode `docker compose up -d api` (o `up` relê o `api.env`).
4. Publique (`deploy\publicar.ps1`): o container sobe junto com os outros. Sem mapa, ele fica esperando a pasta
   `dados/atual` aparecer, e a API usa linha reta enquanto isso.

Para conferir de dentro da API (deve responder `"code":"Ok"` com a distância em metros):

```bash
docker exec effex_api node -e "fetch('http://osrm:5000/route/v1/driving/-38.5014,-12.9714;-38.4567,-12.9990?overview=false').then(r=>r.text()).then(console.log)"
```

No ar, o `effex_osrm` usa uns 2,3 GB (limite de 6 GB no `docker-compose.yml`).

O mapa é atualizado todo dia 1º, à 1h do servidor (UTC; 22h do último dia do mês em Salvador), pelo cron do servidor
(`crontab -l`), antes das cópias de segurança. Para sobrar memória para o preparo, o OSRM fica parado nesses cerca de 20
minutos (o relatório usa linha reta e o km percorrido espera) e volta com o mapa novo; se o preparo falhar, volta com o
anterior, que continua em `dados/atual`. O mapa trocado fica em `dados/anterior` até a atualização seguinte:

```
0 1 1 * * cd /opt/effex-trade/osrm && docker stop effex_osrm > /dev/null; bash preparar-mapa.sh >> /var/log/effex-osrm.log 2>&1; docker start effex_osrm > /dev/null
```

Se o relatório disser "em linha reta" ou o km percorrido ficar "a calcular" por muito tempo: `docker compose ps` (o
`effex_osrm` está no ar?), `docker compose logs osrm --tail 20` e o comando de conferir acima. Na migração para outro
VPS, copie também `/opt/effex-trade/osrm` (ou prepare o mapa de novo lá).

### Cópia de segurança

`deploy/backup_banco.sh` grava um `pg_dump` por dia em `/opt/backups/effex-trade` (14 dias) e espelha as fotos em
`/opt/backups/effex-trade/fotos`. A publicação também faz uma cópia antes de trocar o código. No cron (`crontab -e`):

```
45 3 * * * bash /opt/effex-trade/deploy/backup_banco.sh >> /var/log/effex-backup.log 2>&1
```

Restaurar o banco (perde o que foi gravado depois da cópia):

```bash
docker exec -i effex_banco pg_restore -U effex -d effex --clean --if-exists < /opt/backups/effex-trade/effex-AAAA-MM-DD.dump
cd /opt/effex-trade/deploy && docker compose restart api
```

Essas cópias ficam no próprio servidor: protegem contra erro no sistema, não contra perder o servidor. De vez em
quando, baixe uma para o computador:

```powershell
scp "bi-vps:/opt/backups/effex-trade/effex-*.dump" "$env:USERPROFILE\Documents\backups-effex\"
```

As fotos crescem com o uso (algumas centenas de KB cada). Acompanhe o disco com `df -h /`.

### Trocar a chave da sincronização

1. Gere uma chave: `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Troque `SYNC_KEY=` em `/opt/effex-trade/api.env` e `chave =` no `sync\config.ini` do computador.
3. `cd /opt/effex-trade/deploy && docker compose up -d api` (o `up` relê o `api.env`; o `restart` não).

### Esqueci a senha do administrador

No servidor: `docker exec -it effex_api npm run criar-admin -- admin`. Do PowerShell do computador:

```powershell
ssh -t bi-vps docker exec -it effex_api npm run criar-admin -- admin
```

### Migrar para outra VPS ou outro domínio

Todos os dados estão em dois lugares: o **banco** e a **pasta de fotos**. O endereço das fotos fica gravado no banco
sem o domínio, então nada se perde. A pasta de atualizações do app (`updates`) também vai junto, para os celulares
continuarem recebendo a última sem publicar de novo.

1. No servidor antigo, pare a API (para ninguém gravar durante a mudança) e faça as cópias:

   ```bash
   cd /opt/effex-trade/deploy && docker compose stop api
   bash backup_banco.sh
   tar -czf /tmp/effex-mudanca.tgz -C /opt/effex-trade api.env banco.env uploads updates
   ```

2. No servidor novo (com Docker), faça a [primeira instalação](#primeira-instalação-já-feita-em-29102026), mas, no passo
   1, use o `api.env` e o `banco.env` do antigo (assim ninguém precisa entrar de novo e a chave do `.bat` continua a
   mesma) e as fotos do `tar`. Se lá não houver o Caddy do app de promotoria, a rede `edge` do `docker-compose.yml`
   precisa de outro proxy com HTTPS na frente (um Caddy próprio com o mesmo bloco).
3. Antes de publicar, suba só o banco e restaure a cópia:
   `docker compose up -d banco` e o `pg_restore` de [Cópia de segurança](#cópia-de-segurança); depois publique.
4. Aponte o DNS para o IP novo.
5. **Só se o domínio mudar:**
   - `CORS_ORIGIN` no `api.env`;
   - o nome no bloco do Caddy;
   - `destino` no `sync\config.ini`;
   - no app, `PRODUCTION_API_URL` em `apps/mobile/src/lib/config.ts` e `updates.url` em `apps/mobile/app.json`, num
     APK novo (o endereço das atualizações fica gravado no APK; veja [app_android.md](app_android.md)); quem trocou o
     servidor na tela de login precisa trocar de novo lá;
   - mantenha o domínio antigo apontando (ou redirecionando) para o servidor novo até todos instalarem o APK novo: os
     APKs antigos continuam usando o endereço antigo para a API e para as atualizações.

O painel usa a API pelo caminho relativo `/api`, então ele não precisa ser refeito para um domínio novo.
