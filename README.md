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
| `admin` | Administrador | painel completo, altera regras e usuários |
| `supervisor` | Supervisor (Renata Moura) | painel da equipe e módulo supervisor no app |
| `vendedor1`, `vendedor2` | Vendedor | auditoria de fotos no app |
| `promotor1`, `promotor2`, `promotor3` | Promotor | roteiro do dia no app |

O seed cria 18 clientes em Salvador-BA, roteiros de segunda a sábado, 3 dias de histórico (visitas, fotos, rastro de GPS, auditorias e conferências) e o dia de hoje em andamento. Rode `npm run db:seed` de novo a qualquer momento para restaurar.

Para testar o check-in com o celular de verdade, cadastre no painel um cliente no endereço onde você está (Clientes > Novo cliente > clique no mapa) e coloque-o no roteiro de hoje do promotor, ou peça a liberação "check-in fora da cerca" pelo app e aprove como supervisor.

## O que já funciona

**App do promotor:** roteiro do dia gerado a partir do roteiro fixo, que começa sozinho no primeiro check-in; inclusão de clientes extras (inclusive repetidos); abertura do atendimento com foto da fachada e cerca eletrônica validada na API, bloqueio de GPS falso e de fora da ordem; atendimento guiado (antes, depois identificando os produtos, confirmação de ruptura contra o mix do cliente); fotos só pela câmera (também vencimento e atividade extra); check-out na cerca; encerramento automático do atendimento esquecido; encerramento do roteiro só completo ou com as lojas pendentes justificadas; pedidos de liberação ao supervisor; envio da localização a cada 3 minutos.

**Painel:** visão do dia; mapa com atualização automática (3 min), clientes do dia por status (feito, justificado, não feito, em atendimento), posição e rastro do promotor, filtro por promotor; relatório de execução (tempo em cada cliente, deslocamento, jornadas, rupturas, justificativas, encerramentos automáticos, exportação para planilha); catálogo de produtos e mix dos clientes (com importação por planilha); avaliação de fotos com nota e observação; liberações; correções de auditoria com PDF para o vendedor; cadastros (usuários, clientes com mapa e importação por planilha, roteiros, atividades extras, motivos) e regras.

**Supervisor (app):** caixa de pedidos de liberação, liberação direta (inverter ordem, substituir cliente, liberar sem fotos, check-in fora da cerca), auditoria das fotos dos promotores e conferência das auditorias dos vendedores.

**Vendedor (app):** auditoria das fotos dos seus clientes, aprovando ou reprovando com justificativa.

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
| Atividades extras | Cada atividade pode exigir foto ou só a confirmação do promotor (com observação), e pode ser obrigatória: obrigatória pendente trava o check-out. |
| Voltar a um cliente | Cliente já atendido no dia não entra de novo como extra: o promotor reabre o atendimento e continua de onde parou (fotos, atividades e passos continuam feitos). Cada reabertura exige cerca e foto da fachada; o tempo no cliente soma as aberturas. |
| Ordem do roteiro | Ligada ou desligada por dia da semana (e por promotor, como exceção). |
| Fotos com data e hora | A API grava na própria imagem uma faixa com data e hora, tipo da foto, cliente e promotor. Também corrige a orientação e limita a foto a 2048 px. |
| Ponto | Início do trabalho = abertura do primeiro atendimento. Fim do trabalho = horário da última atividade (check-out, foto ou justificativa em campo), e não o horário em que o roteiro foi encerrado (que fica registrado à parte). |
| Almoço | Botão "Iniciar almoço" abaixo de "Incluir cliente extra". Durante o almoço nenhuma atividade é feita; a volta é a abertura do próximo cliente (ou a justificativa dele, se estiver fechado, feita na cerca dele ou do cliente seguinte). Um almoço por dia, só depois do primeiro atendimento. Não há tempo mínimo nem horário fixo, mas se o almoço passar de 2h (configurável) o supervisor recebe um alerta no app e no painel, até marcar "ciente". O almoço sai do deslocamento e das horas trabalhadas. |

Também: raio da cerca (com exceção por cliente), bloqueio de GPS falso, precisão mínima do GPS, ordem obrigatória do roteiro, clientes extras e limite por dia, tempo mínimo no cliente, tamanho mínimo da justificativa, intervalo de rastreamento, atualização do mapa e escala da nota das fotos.

O **mix do cliente** (o que ele compra no período) é a base do contraste de ruptura. Enquanto a fonte definitiva não está ligada, ele é carregado no painel em **Produtos e mix** (planilha `cliente_codigo;produto_codigo`) ou editado no cadastro de cada cliente.

Para criar uma regra nova: acrescente o campo em `settingsSchema`, `defaultSettings` e `settingsMeta` (o painel monta o formulário sozinho) e aplique a regra no serviço correspondente (normalmente `src/services/visits.ts`).

## Tipos de liberação do supervisor

Ficam em `apps/api/src/services/permissions.ts`, cada um com `validate` (o pedido ainda faz sentido?) e `apply` (o que muda quando aprovado). Hoje: check-in fora da cerca, liberar sem fotos, alterar ordem de atendimento e substituir cliente. Para criar outro, acrescente um item na lista `permissionTypes`; o pedido, a aprovação, o histórico e o relatório já funcionam para ele.

## Testes

Com a API rodando e o seed carregado:

```bash
cd apps/api
npm run smoke        # verificações de ponta a ponta (login, cerca, ordem, fachada, sequência, ruptura, encerramentos, liberações, auditorias, relatório, PDF)
npm run db:seed      # restaura os dados depois do teste
```

## Antes de colocar em produção

- Trocar `JWT_SECRET` e usar um PostgreSQL gerenciado (`DATABASE_URL`); rodar `npx prisma migrate deploy` no deploy.
- Fotos: hoje ficam em disco (`UPLOAD_DIR`) e são servidas sem login em `/uploads` (nomes impossíveis de adivinhar). Para produção, mover para um storage (S3, R2 ou GCS) com links assinados; a troca fica isolada em `src/services/storage.ts`.
- Servir a API e o painel com HTTPS e restringir o CORS ao domínio do painel (`src/app.ts`).
- A faixa de data e hora das fotos usa as fontes do sistema. Em servidor Linux enxuto, instale uma fonte (ex.: `apt-get install fonts-dejavu-core`), senão o texto sai sem letras.
- App: gerar o APK/AAB com EAS (o rastreamento em segundo plano não funciona no Expo Go). Com o app instalado, o próximo passo é a notificação push dos alertas ao supervisor (hoje ele vê o alerta quando abre o app ou o painel).

## Integração futura com a gestão de trade

A API já expõe tudo em JSON com autenticação por token, então os próximos módulos (metas, agenda, tarefas, campanhas, assistente de IA) consomem os mesmos dados. Os pontos naturais de integração são visitas e jornadas (`Visit`, `WorkDay`), fotos e auditorias (`Photo`, `PhotoAudit`, `AuditReview`), atividades extras (`Task`, embrião de campanhas e tarefas) e rastreamento (`LocationPing`).
