# EFFEX Trade - app mobile

App único (Expo SDK 58 + Expo Router) com três módulos, escolhidos pelo perfil do login:

- **Promotor**: roteiro do dia, atendimento guiado (fachada, antes, depois com produtos, ruptura, check-out), justificativas, clientes extras, encerramento do roteiro e pedidos de liberação ao supervisor. Envia a localização a cada N minutos enquanto o roteiro está aberto.
- **Vendedor**: auditoria das fotos dos seus clientes (aprovar, ou reprovar com justificativa).
- **Supervisor** (o admin também cai aqui): alertas da equipe (almoço acima do limite), caixa de liberações, auditoria de fotos da equipe, conferência das auditorias dos vendedores, equipe do dia e liberação direta.

## Como rodar

```bash
cd apps/mobile
npm install
npx expo start
```

Abra o **Expo Go** no celular (Android ou iOS) e leia o QR code. O celular precisa estar na mesma rede Wi-Fi do computador.

A API precisa estar rodando (`npm run db` e `npm run api` na raiz do projeto).

### Endereço da API

O celular não acessa `localhost`. Por padrão o app usa o IP do computador que roda o `expo start`, na porta 3333 (ex.: `http://192.168.18.97:3333`). Para trocar:

- na tela de login, toque em **Servidor: ... alterar**, informe o endereço e toque em **Testar e salvar** (fica salvo no aparelho); ou
- crie `apps/mobile/.env` com `EXPO_PUBLIC_API_URL=http://SEU_IP:3333` (veja `.env.example`).

O servidor de produção é `https://effextrade.maisvida.cloud/api` (o painel fica no mesmo domínio). O APK e as atualizações já saem apontando para ele (`PRODUCTION_API_URL` em `src/lib/config.ts`: eles não leem arquivos `.env`). Digitado na tela de login sem `http://`, um domínio vai com `https://` (o APK não aceita http) e um IP vai com `http://`.

Se o Windows bloquear, libere a porta 3333 no firewall para a rede privada.

Logins de teste (senha `123456`): `promotor1`, `promotor2`, `promotor3`, `vendedor1`, `vendedor2`, `supervisor`.

## Fluxo do promotor (regras atuais)

Cada regra pode ser ligada ou desligada pelo administrador no painel (Regras); o app lê as regras do dia em `/promotor/day`.

As fotos chegam ao servidor e recebem uma faixa gravada na imagem com data e hora, tipo da foto, cliente e promotor.

1. **Roteiro e ponto**: não há botão de iniciar. O roteiro começa na abertura do primeiro atendimento, que é o **início do trabalho**; o rastreamento liga nessa hora. O **fim do trabalho** é o horário da última atividade (check-out, foto ou justificativa feita em campo), não o do toque em "Encerrar roteiro" (que aparece à parte).
2. **Abrir atendimento**: o app confere a cerca eletrônica e a ordem do roteiro e só então abre a câmera para a **foto da fachada**. A foto vai junto com o check-in.
3. **Passos do atendimento**, nesta ordem: foto de antes, fotos de depois (marcando os produtos que aparecem em cada uma; a lista mostra só os produtos que o cliente compra), confirmação de ruptura (produtos do mix do cliente que não aparecem em nenhuma foto de depois) e check-out (também dentro da cerca). Depois da primeira foto de depois, a foto de antes fica bloqueada. Se a foto de depois for tirada poucos minutos depois da de antes (regra "Aviso de foto de depois muito rápida", padrão 3 min), o app pergunta se não é uma foto de antes; se o promotor confirmar, a foto vai marcada para o painel. Vencimento pode ser fotografado a qualquer momento.
4. **Atividades extras**: aparecem antes do check-out, com os selos "Obrigatória" e "Exige foto"/"Sem foto". As de foto são concluídas fotografando; as sem foto, pelo botão "Concluir atividade" (com observação/resposta opcional). Atividade obrigatória pendente trava o check-out.
5. **Almoço**: botão "Iniciar almoço" abaixo de "+ Incluir cliente extra" (depois do primeiro atendimento, sem atendimento aberto, uma vez por dia). Durante o almoço nenhuma atividade pode ser feita; a volta do almoço é a abertura do próximo cliente (ou a justificativa dele, se estiver fechado; feita com GPS na cerca dele ou do cliente seguinte do roteiro). Não há tempo mínimo nem horário fixo; se o almoço passar do limite das regras (padrão 2h), o supervisor é alertado, e o app avisa isso ao promotor.
6. **Atendimento esquecido**: se o promotor abrir o próximo cliente sem fazer o check-out, o anterior é encerrado sozinho no horário da última foto tirada nele, e o app avisa.
7. **Voltar a um cliente já atendido**: em vez de incluir o cliente de novo, o promotor abre a visita concluída e toca em **Reabrir atendimento** (cerca e foto da fachada, como na abertura; a ordem do roteiro não vale). Fotos, produtos, ruptura e atividades já feitos continuam valendo; é preciso fazer o check-out de novo. A visita mostra todas as aberturas (ex.: "08:10–08:50 e 14:00–14:20") e o tempo no cliente é a soma delas. Na busca de clientes extras, quem já está no dia aparece marcado e o toque leva para a visita.
8. **Encerrar roteiro**: com clientes ainda pendentes, o promotor precisa justificar cada um (ou usar o mesmo motivo para todos) na tela de encerramento.

**Dica para testar o check-in:** os clientes de exemplo ficam em Salvador-BA. Longe deles, o check-in vai ser recusado pela cerca eletrônica. Nesse caso, use **Pedir liberação** e aprove com o login `supervisor` em outro aparelho. Outra opção é cadastrar no painel um cliente no seu endereço.

## Rastreamento em segundo plano

- **No Expo Go**, a localização só é enviada **com o app aberto**, porque o Expo Go não suporta localização em segundo plano nem serviço em primeiro plano no Android. A tela Conta mostra o modo em uso.
- **No app instalado** (development build ou APK), uma tarefa em segundo plano envia a posição mesmo com a tela desligada. No Android aparece a notificação fixa "jornada em andamento". O app pede a permissão de localização "o tempo todo".
- As posições ficam numa fila no aparelho e são reenviadas em lote quando a internet volta.

## APK e atualizações

O app é distribuído como APK (sem Play Store, só Android), gerado neste computador com `deploy\gerar-apk.ps1` (antes, uma vez: `deploy\preparar-android.ps1`, que instala o Android SDK e cria a chave de assinatura), na pasta `apk\` da raiz do projeto. O código novo chega aos celulares por atualização automática (expo-updates), servida pela própria API (`/updates`) e publicada com `deploy\atualizar-app.ps1`; APK novo só quando muda a parte nativa (o script avisa). A tela Conta (todos os perfis) mostra a versão e o código em uso e tem o botão **Buscar atualização**, que aplica na hora. Passo a passo, mensagem para os usuários e cuidados: [docs/app_android.md](../../docs/app_android.md).

## Telas

| Rota | Tela |
| --- | --- |
| `/login` | Login + endereço do servidor |
| `/promotor` | Meu dia: situação do roteiro, início/fim do trabalho, almoço, lista de clientes com status, próximo cliente, cliente extra, iniciar almoço |
| `/promotor/visita/[id]` | Atendimento em passos: abrir com a foto da fachada, antes, depois com produtos (editar produtos na foto), confirmar ruptura, atividades extras, check-out; vencimento; justificativa e pedidos; reabrir atendimento concluído |
| `/promotor/encerrar` | Encerrar roteiro, justificando os clientes que ficaram sem atendimento |
| `/promotor/adicionar` | Buscar e incluir cliente extra; cliente que já está no dia leva para a visita (abrir ou reabrir) |
| `/promotor/pedido` | Pedir liberação (fora da cerca, dispensa de fotos, troca de cliente) |
| `/promotor/ordem` | Propor nova ordem dos pendentes (ex.: antecipar cliente) |
| `/promotor/liberacoes` | Pedidos de hoje e status; cancelar pendente |
| `/promotor/conta` | Conta, troca de senha, status do rastreamento, versão do app e "Buscar atualização" (a versão e o botão também estão na Conta do vendedor e do supervisor) |
| `/vendedor` | Auditoria de fotos (pendentes / auditadas / todas, filtros) |
| `/supervisor` | Alertas (almoço acima do limite, com duração ao vivo, "Ligar" e "Ciente") e liberações: aprovar ou negar pedidos dos promotores. O contador da aba soma pedidos e alertas; alerta novo mostra um aviso e vibra, uma vez por alerta, com o app aberto |
| `/supervisor/fotos` | Auditoria de fotos da equipe (vê a decisão do vendedor) |
| `/supervisor/vendedores` | Conferir auditorias dos vendedores (correta / incorreta + orientação) |
| `/supervisor/equipe` | Promotores (andamento do dia; em vermelho quem tem alerta de almoço) e vendedores |
| `/supervisor/promotor/[id]` | Dia do promotor + liberação direta e alteração de ordem |

## Estrutura

```
src/app/         rotas (Expo Router)
src/features/    telas e componentes de cada módulo (auditoria, contexto do dia do promotor, cartões)
src/components/  componentes de interface (botões, campos, folhas, abas)
src/lib/         API, login, localização, rastreamento, formatação, tipos
```

Verificação: `npm run typecheck`, `npm run export:android` e `npx expo-doctor`.

**Alertas com o app fechado:** o aviso de almoço acima do limite aparece com o app aberto (consulta a cada 45 s). Notificação com o app fechado (push) ainda não está ligada: o APK e o projeto Expo já existem, falta configurar o envio (Firebase/FCM) e o registro dos aparelhos.
