# EFFEX Trade

Sistema de acompanhamento da promotoria de vendas, base para a futura gestão de trade (metas, agenda do gestor, tarefas, campanhas, assistente de IA).

| Parte | Onde | Para quem |
|---|---|---|
| API (regras, dados, fotos, PDF) | `apps/api` | todos os apps |
| Painel administrativo (web) | `apps/admin` | administrador e supervisor |
| App mobile (um app, três módulos) | `apps/mobile` | promotor, vendedor e supervisor |

## Como rodar no computador

Pré-requisito: Node.js 22 ou mais novo. Cada parte tem seu próprio `node_modules`.

```bash
cp apps/api/.env.example apps/api/.env   # só na primeira vez (no Windows: copy)
npm run install:all          # instala api, admin e mobile

# terminal 1 - banco de dados local (PostgreSQL embutido, sem instalação de administrador)
npm run db

# terminal 2 - primeira vez: cria as tabelas e carrega dados de exemplo
cd apps/api
npx prisma migrate deploy
npm run db:seed
npm run dev                  # API em http://localhost:3333

# terminal 3 - painel
npm run admin                # http://localhost:5173

# terminal 4 - app (ver apps/mobile/README.md)
npm run mobile
```

O npm 11 pede aprovação de scripts de instalação. Os pacotes já aprovados estão em `allowScripts` no `package.json` de cada app.

O banco local fica em `%LOCALAPPDATA%\effex-trade` (fora do OneDrive, porque a sincronização corrompe arquivos do Postgres e o Postgres não aceita caminho com acento como "Área de Trabalho").

### Logins de exemplo (senha `123456`)

| Login | Perfil | Observação |
|---|---|---|
| `admin` | Administrador | painel completo, altera regras e usuários; vê todos os clientes |
| `supervisor` | Supervisor (Renata Moura) | painel da equipe e módulo supervisor no app; cidades: BA inteira |
| `vendedor1`, `vendedor2` | Vendedor | auditoria de fotos no app; cidades: Salvador (o 2 também Lauro de Freitas) |
| `promotor1`, `promotor2`, `promotor3` | Promotor | roteiro do dia no app; cidades: Salvador (o 3 também Lauro de Freitas) |

O seed cria 18 clientes em Salvador-BA (nos roteiros) e 4 em Lauro de Freitas-BA (um deles sem localização), roteiros de segunda a sábado, 3 dias de histórico (visitas, fotos, rastro de GPS, auditorias e conferências) e o dia de hoje em andamento. Rode `npm run db:seed` de novo a qualquer momento para restaurar.

Para testar o check-in com o celular de verdade, cadastre no painel um cliente no lugar onde você está (Clientes > Novo cliente > clique no mapa), numa cidade atendida pelo promotor, e coloque-o no roteiro de hoje dele, ou peça a liberação "check-in fora da cerca" pelo app e aprove como supervisor.

## O que já funciona

**App do promotor:** roteiro do dia gerado a partir do roteiro fixo, que começa sozinho no primeiro check-in; inclusão de clientes extras (inclusive repetidos); abertura do atendimento com foto da fachada e cerca eletrônica validada na API, bloqueio de GPS falso e de fora da ordem; atendimento guiado (antes, depois identificando os produtos, confirmação de ruptura contra o mix do cliente); fotos só pela câmera (também vencimento e atividade extra); check-out na cerca; encerramento automático do atendimento esquecido; encerramento do roteiro só completo ou com as lojas pendentes justificadas; pedidos de liberação ao supervisor; envio da localização (na loja, a cada 3 minutos; fora dela, com GPS de alta precisão, a cada 30 s em movimento ou a cada 200 m).

**Painel:** visão do dia; mapa com atualização automática (3 min), clientes do dia por status (feito, justificado, não feito, em atendimento), posição e rastro do promotor, filtro por promotor; relatório de execução (tempo em cada cliente, deslocamento com km pela rota e km percorrido pelo GPS, jornadas, rupturas, justificativas, encerramentos automáticos, exportação para planilha); catálogo de produtos e mix dos clientes (com importação por planilha); avaliação de fotos com nota e observação; liberações; correções de auditoria com PDF para o vendedor; cadastros (usuários de todos os perfis com as cidades atendidas, clientes com mapa e planilha para baixar e importar a localização, roteiros com seleção de vários clientes e frequência por dia, atividades extras, motivos) e regras.

**Supervisor (app):** caixa de pedidos de liberação, liberação direta (inverter ordem, substituir cliente, liberar sem fotos, check-in fora da cerca), visita pontual (incluir um cliente para o promotor hoje ou num dia futuro, com recado), auditoria das fotos dos promotores e conferência das auditorias dos vendedores.

**Vendedor (app):** auditoria das fotos dos clientes das suas cidades, aprovando ou reprovando com justificativa.

## Clientes e cidades dos usuários

O cadastro do cliente tem só **nome fantasia** (o nome mostrado em todo o sistema), **razão social**, **cidade**, **UF** e **localização** (latitude e longitude).

**Clientes do ERP:** `sync\sincronizar-clientes.bat` lê a tabela CLIENTES da cópia do banco do ERP (Firebird, a mesma do BI Mais Vida) e manda a lista para `POST /sync/clientes`, assinada com a `SYNC_KEY` (HMAC-SHA256, como o envio do BI). A API cria os novos, atualiza nome, razão social, cidade, UF e situação dos que mudaram e inativa os que saíram do ERP, sem tocar em mix, roteiros e visitas (`src/services/erp-sync.ts`). A localização também vem do ERP (`CLIENTES.LATITUDADE`/`LONGITUDE`) e fica marcada com a origem (`Client.locationSource`): a do ERP a sincronização atualiza; corrigida no painel ou pela planilha, ela passa a `PAINEL` e a sincronização não a muda mais (mandar o mesmo ponto não conta como correção). Cada cliente guarda o código do ERP (`Client.erpId`); nos que têm código, esses campos ficam só leitura no painel, e, depois da primeira sincronização, o cadastro manual fecha (`POST /admin/clients` responde `CLIENTE_PELO_ERP`). Detalhes e problemas comuns em [docs/publicacao_vps.md](docs/publicacao_vps.md). Para testar no computador: `SYNC_KEY` no `apps/api/.env`, a mesma em `chave` no `sync/config.ini` e `destino = http://localhost:3333`.

Para preencher ou corrigir a localização de vários clientes de uma vez (um por um, é no mapa do cadastro):

1. Em **Clientes**, use **Baixar planilha** (ou "Baixar planilha deles", só os sem localização). A planilha tem `id;codigo_erp;razao_social;nome_fantasia;cidade;uf;latitude;longitude;origem_localizacao` (`codigo_erp` e `origem_localizacao` são só para conferência).
2. Preencha latitude e longitude (com vírgula ou ponto; no lugar das duas, também vale uma coluna `coordenadas` com o texto copiado do Google Maps, ex.: `-12.9714, -38.5014`).
3. **Importar planilha** (só administrador). A linha com `id` altera aquele cliente; sem `id`, o cliente é procurado pelo nome fantasia (ou razão social) na mesma cidade e UF, sem diferença de acento e maiúsculas, e é cadastrado se não existir. Com dois clientes de mesmo nome fantasia na cidade, a razão social desempata; se nem ela resolver, a linha volta pedindo o `id`. Latitude e longitude vazias mantêm a localização atual; iguais à atual não mudam nada; diferentes passam a valer e ficam marcadas como do painel (a sincronização com o ERP não as muda mais). Com os clientes vindo do ERP, linha sem cliente correspondente não cria cadastro, e dos clientes do ERP só a localização é importada.

Cliente **sem localização** fica cadastrado, mas não entra em roteiro, visita pontual, cliente extra nem substituição (não há como validar a cerca). Depois de ter localização, ela não pode ser apagada, só corrigida. O raio da cerca é o das regras, igual para todos os clientes.

**Promotor, vendedor e supervisor** têm no cadastro (Usuários) as **cidades atendidas**: UF + cidade, ou a UF inteira. Só os clientes dessas cidades aparecem para eles: o promotor na busca de cliente extra e de substituição, o supervisor na visita pontual e na substituição (cruzando também com as cidades do promotor escolhido) e na lista de clientes do painel, o vendedor e o supervisor nas fotos para auditar. O roteiro do promotor só aceita clientes das cidades dele; se uma cidade sair do cadastro, os clientes dela ficam marcados em vermelho em Roteiros e o dia só é salvo depois de tirá-los. O administrador vê todos. A comparação das cidades ignora acento e maiúsculas ("Vitória" = "VITORIA").

## Regras do promotor

Ficam em `apps/api/src/services/settings.ts` e são ligadas e desligadas no painel em **Regras**. Cada alteração pode valer para **todos os promotores** (regra geral) ou só para **promotores escolhidos** (exceção); há um atalho para escolher os promotores que atendem os clientes de um vendedor, e a lista de exceções permite voltar cada promotor à regra geral.

| Regra | Como funciona |
|---|---|
| Roteiro completo | O promotor só encerra o roteiro com todas as lojas atendidas; para encerrar antes, justifica cada loja pendente na mesma tela. |
| Cerca eletrônica | Abertura (check-in) e encerramento (check-out) só dentro do raio da loja. Não vale para o encerramento automático nem quando o supervisor libera. |
| Abertura do roteiro | Não existe botão de iniciar: o roteiro começa no primeiro check-in. O primeiro cliente do dia não tem tempo de deslocamento. |
| Abertura do atendimento | Exige a foto da fachada, tirada na hora do check-in. |
| Sequência do atendimento | Nesta ordem: foto de antes, fotos de depois marcando os produtos que aparecem, e confirmação de que os produtos do mix do cliente que não aparecem nas fotos de depois são ruptura. Tudo é exigido para o check-out. Mexer nas fotos de depois desfaz a confirmação. |
| Atendimento esquecido | Ao abrir o próximo atendimento, o anterior esquecido é encerrado no horário da última foto tirada nele; o deslocamento conta dessa foto até a nova abertura. Roteiro de dia anterior que ficou aberto é encerrado no último check-out. |
| Foto de depois rápida | Se a foto de depois sai menos de 3 minutos (configurável) depois da de antes, o app avisa "verifique se essa foto não é de antes, está lançando no depois". Se o promotor confirmar, a foto fica marcada no painel. Depois da primeira foto de depois, a de antes fica bloqueada. |
| Produtos do cliente | Nas fotos de depois só aparecem (e só são aceitos) os produtos do mix do cliente. Sem mix cadastrado, aparece o catálogo inteiro. |
| Atividades extras | Cada atividade pode exigir foto ou só a confirmação do promotor (com observação), e pode ser obrigatória: obrigatória pendente trava o check-out. Recorrência escolhida por quem cria: uma vez (pontual), semanal (segunda a domingo), quinzenal, mensal ou toda visita; feita numa visita, não aparece nas outras visitas da mesma janela no cliente. A data de fim é opcional. |
| Estrutura do atendimento | Cada cliente do roteiro (e cada visita pontual) tem uma combinação livre de etapas: padrão (antes, depois e ruptura), atividade extra e contagem de estoque. Todo cliente novo entra com padrão + atividade extra. A fachada no check-in vale para todas. Na contagem de estoque a contagem é feita fora do app: o promotor só confirma que fez, e o check-out só sai com a confirmação. Só com atividade extra, o cliente entra no roteiro apenas nos dias em que houver atividade para fazer. |
| Voltar a um cliente | Cliente já atendido no dia não entra de novo como extra: o promotor reabre o atendimento e continua de onde parou (fotos, atividades e passos continuam feitos). Cada reabertura exige cerca e foto da fachada; o tempo no cliente soma as aberturas. |
| Ordem do roteiro | Ligada ou desligada por dia da semana (e por promotor, como exceção). |
| Frequência no roteiro | Cada cliente, em cada dia da semana, é semanal (padrão), quinzenal, mensal (a mesma semana do mês da primeira visita, ex.: toda 1ª segunda) ou personalizado: pulando X semanas, ou de X em X dias. "De X em X dias" pode cair em outro dia da semana; nesse dia o cliente entra no fim da ordem. Quando cai no domingo, passa para a segunda (próximo dia útil) e a série continua contando a partir do domingo. |
| Visita pontual | O supervisor inclui pelo app um cliente num único dia do promotor (hoje ou até 30 dias à frente), com a estrutura escolhida e, se quiser, uma atividade escrita na hora (obrigatória, só nessa visita). Entra no fim da lista, fora da ordem do roteiro; o promotor não pode removê-la e, se não atender, justifica. O supervisor desfaz enquanto a visita não começou. |
| Fotos com data e hora | A API grava na própria imagem uma faixa com data e hora, tipo da foto, cliente e promotor. Também corrige a orientação e limita a foto a 2048 px. |
| Ponto | Início do trabalho = abertura do primeiro atendimento. Fim do trabalho = horário da última atividade (check-out, foto ou justificativa em campo), e não o horário em que o roteiro foi encerrado (que fica registrado à parte). |
| Almoço | Botão "Iniciar almoço" abaixo de "Incluir cliente extra". Durante o almoço nenhuma atividade é feita; a volta é a abertura do próximo cliente (ou a justificativa dele, se estiver fechado, feita na cerca dele ou do cliente seguinte). Um almoço por dia, só depois do primeiro atendimento. Não há tempo mínimo nem horário fixo, mas se o almoço passar de 2h (configurável) o supervisor recebe um alerta no app e no painel, até marcar "ciente". O almoço sai do deslocamento e das horas trabalhadas. |

Também: raio da cerca, bloqueio de GPS falso, precisão mínima do GPS, ordem obrigatória do roteiro, clientes extras e limite por dia, tempo mínimo no cliente, tamanho mínimo da justificativa, rastreamento (intervalo na loja e, fora dela, intervalo e distância de envio), atualização do mapa e escala da nota das fotos.

O **mix do cliente** (o que ele compra no período) é a base do contraste de ruptura. Enquanto a fonte definitiva não está ligada, ele é carregado no painel em **Produtos e mix** (planilha `nome_fantasia;cidade;uf;produto_codigo`, ou `cliente_id;produto_codigo` com o id da planilha de clientes) ou editado no cadastro de cada cliente.

Para criar uma regra nova: acrescente o campo em `settingsSchema`, `defaultSettings` e `settingsMeta` (o painel monta o formulário sozinho) e aplique a regra no serviço correspondente (normalmente `src/services/visits.ts`).

## Km de deslocamento (relatório de execução)

Cada trecho vai da saída de um cliente (check-out) até a abertura do seguinte (check-in); a ida de casa ao primeiro cliente e a volta do último ficam de fora, porque o rastreamento só liga no primeiro check-in e desliga no encerramento do roteiro. O relatório mostra dois números:

- **Km pela rota:** caminho mais curto de carro entre a localização cadastrada de um cliente e a do seguinte, calculado na hora pelo servidor de rotas (OSRM, [infra/osrm](infra/osrm/README.md)); sem ele, em linha reta. A sugestão de ordenação dos roteiros usa as mesmas distâncias.
- **Km percorrido (GPS):** o caminho que o celular registrou no trecho, com os pontos encaixados nas ruas pelo mesmo servidor (`src/services/gps-km.ts`). Antes do encaixe saem os pontos de GPS falso, os com margem de erro acima de 100 m, os saltos que vão e voltam acima de 180 km/h e os "pulos" com o promotor parado (menos de 50 m ou da margem de erro do ponto). Onde faltam pontos por mais de dois intervalos de envio (sem sinal, celular desligado ou sem permissão), aquele pedaço é a rota estimada e o trecho fica marcado ("parte estimada" ou "estimado"). É calculado uma vez, 5 minutos depois que o dia é encerrado (o dia esquecido aberto, depois da meia-noite), e gravado em `VisitSession.gpsMeters`: o relatório só lê e o número não muda. Em produção, sem o servidor de rotas o dia espera o servidor voltar; no computador, sem `OSRM_URL`, os pontos são ligados em linha reta.

A diferença entre os dois mostra desvios e trajetos fora do esperado (inclusive a ida e a volta do almoço, que entram no km percorrido).

## Tipos de liberação do supervisor

Ficam em `apps/api/src/services/permissions.ts`, cada um com `validate` (o pedido ainda faz sentido?) e `apply` (o que muda quando aprovado). Hoje: check-in fora da cerca, liberar sem fotos, alterar ordem de atendimento e substituir cliente. Para criar outro, acrescente um item na lista `permissionTypes`; o pedido, a aprovação, o histórico e o relatório já funcionam para ele.

## Testes

Com a API rodando e o seed carregado:

```bash
cd apps/api
npm run smoke        # verificações de ponta a ponta (login, cerca, ordem, fachada, sequência, ruptura, encerramentos, liberações, auditorias, relatório, PDF)
npm run db:seed      # restaura os dados depois do teste
```

## Produção

Publicado em **https://effextrade.maisvida.cloud** (painel) e **https://effextrade.maisvida.cloud/api** (API), em Docker no VPS do BI: `apps/api/Dockerfile`, `deploy/` e o guia [docs/publicacao_vps.md](docs/publicacao_vps.md) (publicar versão nova com `deploy\publicar.ps1`, cópias de segurança, migrar de servidor ou de domínio). O banco começa vazio: o primeiro administrador é criado com `npm run criar-admin`.

- `JWT_SECRET`, `SYNC_KEY`, `CORS_ORIGIN` (domínio do painel), `TRUST_PROXY=true` e `OSRM_URL=http://osrm:5000` ficam no `api.env` do servidor. As migrações rodam sozinhas quando a API sobe (`prisma migrate deploy`).
- O servidor de rotas (OSRM) roda no mesmo VPS, como o serviço `osrm` do `deploy/docker-compose.yml`, só visível para a API; o mapa é preparado no próprio VPS e atualizado todo mês ([docs/publicacao_vps.md](docs/publicacao_vps.md#servidor-de-rotas-osrm)).
- O painel usa a API pelo caminho relativo `/api` (`apps/admin/.env.production`), no mesmo domínio.
- O app Android é um APK enviado aos usuários (sem Play Store), gerado no computador com `deploy\gerar-apk.ps1` na pasta `apk\`. O código novo chega por atualização automática servida pela própria API (`/api/updates`, publicações em `/opt/effex-trade/updates`), publicada com `deploy\atualizar-app.ps1`: [docs/app_android.md](docs/app_android.md).
- A imagem da API instala a fonte DejaVu: a faixa de data e hora das fotos precisa de uma fonte no sistema.

Ainda pendente:

- Fotos: ficam em disco (`UPLOAD_DIR`) e são servidas sem login em `/uploads` (nomes impossíveis de adivinhar). O próximo passo é um storage (S3, R2 ou GCS) com links assinados; a troca fica isolada em `src/services/storage.ts`.
- App: notificação push dos alertas ao supervisor (hoje ele vê o alerta quando abre o app ou o painel). O APK e as atualizações automáticas já existem ([docs/app_android.md](docs/app_android.md)).
- App: registrar o pacote `com.effex.trade` no Android Developer Console antes de 2027, quando o Google passa a exigir desenvolvedor verificado também para APK instalado fora de loja (passo a passo em [docs/app_android.md](docs/app_android.md#verificação-de-desenvolvedor-do-google-prazo-2027)).
- Pontos de GPS (`LocationPing`) não são apagados: com o km percorrido gravado, dá para definir um prazo de guarda (ex.: alguns meses).

## Integração futura com a gestão de trade

A API já expõe tudo em JSON com autenticação por token, então os próximos módulos (metas, agenda, tarefas, campanhas, assistente de IA) consomem os mesmos dados. Os pontos naturais de integração são visitas e jornadas (`Visit`, `WorkDay`), fotos e auditorias (`Photo`, `PhotoAudit`, `AuditReview`), atividades extras (`Task`, embrião de campanhas e tarefas) e rastreamento (`LocationPing`).
