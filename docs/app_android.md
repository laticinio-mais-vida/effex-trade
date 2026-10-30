# App Android (APK)

O app dos promotores, vendedores e supervisores é instalado por um arquivo **APK**, sem Play Store. Só Android: iPhone
não é atendido. O APK é gerado neste computador, e o código novo (telas, regras, textos) chega sozinho aos celulares
pelas **atualizações automáticas**, servidas pela própria API do sistema. Não há conta em serviço externo. APK novo só
é preciso quando muda a parte nativa do app.

A primeira parte deste guia é a rotina de quem distribui o app. A [parte técnica](#parte-técnica) é para quem mexe no
código ou no servidor.

## Gerar o APK

**Uma vez por computador**, no PowerShell, na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\preparar-android.ps1
```

Ele confere o Java, instala o Android SDK (sem Android Studio) e cria a **chave de assinatura** do app em
`Documentos\EFFEX Trade - chave do app`. **Guarde uma cópia dessa pasta fora do computador** (pendrive guardado ou cofre
de senhas): sem ela, nenhum APK novo instala por cima do antigo. Veja [Chave de assinatura](#chave-de-assinatura).

**A cada APK:**

```powershell
powershell -ExecutionPolicy Bypass -File deploy\gerar-apk.ps1
```

O arquivo sai em `apk\EFFEX-Trade-<versão>-<build>.apk`, por exemplo `apk\EFFEX-Trade-0.1.0-1.apk`. O número do build
sobe sozinho a cada APK. O primeiro build baixa o resto do SDK (alguns GB) e leva de 20 a 40 minutos; os seguintes,
bem menos.

Envie o arquivo aos usuários pelo WhatsApp (como documento) ou por um link do Google Drive, junto com a mensagem abaixo.

## Mensagem para os usuários

> **Instalar o EFFEX Trade (só Android)**
>
> 1. Toque no arquivo **EFFEX-Trade-….apk** que você recebeu (no Drive: Baixar e depois abrir).
> 2. Se aparecer que o celular não pode instalar apps desta fonte, toque em **Configurações**, ative **Permitir
>    desta fonte** e volte.
> 3. Toque em **Instalar**. Se o Play Protect avisar que não reconhece o app, toque em **Mais detalhes** e em
>    **Instalar mesmo assim** (ou **Instalar sem verificar**).
> 4. Abra o app e entre com seu login e senha.
> 5. Permita a **câmera** e a **localização** quando o app pedir. Promotor: no primeiro check-in, o app abre as
>    configurações da localização; escolha **Permitir o tempo todo**.
> 6. Promotor: em Configurações > Apps > EFFEX Trade > Bateria, escolha **Sem restrições** (nos celulares Samsung e
>    Xiaomi, isso impede que o envio da localização pare com a tela desligada).
>
> O app se atualiza sozinho. Para atualizar na hora: tela **Conta** > **Buscar atualização**.

Para atualizar o APK (quando houver um novo), basta instalar o arquivo novo por cima do antigo: não precisa
desinstalar, e o login continua.

## Atualizações

O app procura atualização ao abrir e ao voltar para ele (no máximo a cada 30 minutos) e baixa sozinho. A atualização
baixada entra:

- na próxima vez que o app for aberto do zero;
- ao voltar para o app depois de 15 minutos fora dele, se ele estiver numa tela de abas (Meu dia, Liberações, Conta,
  Avaliação, Alertas, Fotos, Vendedores, Equipe). Nunca no meio de um atendimento, de um encerramento ou de um pedido;
- na hora, pelo botão **Buscar atualização** da tela **Conta** (todos os perfis).

A tela Conta mostra a versão do app (ex.: "App 0.1.0 (build 1)") e o código em uso: "o que veio no APK" ou a data da
atualização.

Para publicar uma atualização, no PowerShell, na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\atualizar-app.ps1 -Mensagem "o que mudou"
```

O script confere o código, monta a atualização e a envia ao servidor (o mesmo acesso `ssh bi-vps` do
`deploy\publicar.ps1`). Se a mudança precisar de APK novo, ele para e avisa.

A rota de atualizações faz parte da API: ela precisa ter sido publicada (`deploy\publicar.ps1`) com essa parte pelo
menos uma vez antes da primeira atualização.

### Quando precisa de APK novo

| Precisa de APK novo | Vai por atualização |
|---|---|
| Instalar ou atualizar pacote com parte nativa (`npx expo install ...`) | Telas, regras, textos, cores, chamadas à API (todo o `src/`) |
| Mudar no `app.json`: plugins, permissões, nome, ícones, pacote, `updates` | Scripts do `package.json`, `.gitignore` |
| Atualizar a versão do Expo | |
| Mudar o `fingerprint.config.js` | |

Na dúvida, rode o `atualizar-app.ps1`: ele compara a parte nativa (o "runtime") com a dos APKs da pasta `apk\`.

Com um APK novo: gere, envie a todos e só então publique atualizações. As atualizações publicadas depois vão só para o
APK novo; quem ficar com o antigo continua funcionando com o último código que recebeu. A API precisa continuar
aceitando o app antigo até todos instalarem o novo.

Para mudar a versão mostrada no app (ex.: 0.1.0 → 0.2.0), mude `version` em `apps/mobile/app.json` antes de gerar o
APK.

### Desfazer uma atualização ruim

O mais simples é corrigir e publicar de novo. Para voltar na hora:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\atualizar-app.ps1 -Desfazer
```

Ele republica a publicação anterior à última; se não houver, manda todos voltarem para o código que veio no APK. Os
celulares recebem isso como uma atualização qualquer.

---

## Parte técnica

### Onde está cada coisa

| O quê | Onde |
|---|---|
| Configuração do app: pacote `com.effex.trade`, `runtimeVersion` (fingerprint), `updates.url` (a API), `android.versionCode` (último build gerado) | `apps/mobile/app.json` |
| O que entra no runtime (fingerprint) | `apps/mobile/fingerprint.config.js` |
| Endereço da API no APK e nas atualizações | `PRODUCTION_API_URL` em `apps/mobile/src/lib/config.ts` |
| Atualização automática e botão (no app) | `apps/mobile/src/lib/updates.ts`, `apps/mobile/src/features/AppVersionCard.tsx` |
| Servidor das atualizações (protocolo expo-updates v1) | `apps/api/src/routes/updates.ts` (`/updates/manifest`) e `apps/api/src/app.ts` (`/updates/files/`) |
| Publicações no VPS (montada só para leitura na API, `UPDATES_DIR`) | `/opt/effex-trade/updates/android/<runtime>/<publicação>/` |
| Scripts | `deploy/preparar-android.ps1`, `deploy/gerar-apk.ps1`, `deploy/atualizar-app.ps1`, `deploy/montar-atualizacao.mjs`, `deploy/app-comum.ps1` |
| Chave de assinatura | `Documentos\EFFEX Trade - chave do app` (`effex-trade.jks` e `chave.properties`) |
| APKs gerados (fora do git) | `apk/` |
| Cópia usada no build (cache, pode ser apagada) | `C:\effex-apk` |
| Android SDK e cache do Gradle | `%LOCALAPPDATA%\Android\Sdk`, `%USERPROFILE%\.gradle` |

### Como o build funciona

O `gerar-apk.ps1` copia `apps/mobile` para `C:\effex-apk`, roda `expo prebuild` e `gradlew assembleRelease` lá e assina
o APK com a chave (`android.injected.signing.*`). A pasta `android` nunca é criada em `apps/mobile`.

O limite de 260 caracteres do Windows é o que mais atrapalha o build do C++: o CMake repete o caminho inteiro de cada
biblioteca no nome dos arquivos intermediários. Por isso a cópia fica num caminho curto e o Gradle recebe
`-Pexpo.android.cmakeObjectPathMax=250`, para o CMake trocar a parte longa desses nomes por um hash (o Expo usa 1024,
que só funciona com caminho longo habilitado no Windows). Antes, ele calcula
o runtime no projeto e grava esse mesmo valor no APK (`EXPO_UPDATES_FINGERPRINT_OVERRIDE`); no fim, confere o runtime
gravado (`assets/fingerprint`) e a assinatura (`apksigner`). Se o build falhar, o número do build volta.

### Como a atualização funciona

O APK leva o runtime da sua parte nativa. O app pede `https://effextrade.maisvida.cloud/api/updates/manifest` com esse
runtime; a API responde com a publicação mais recente dele, ou `204` quando não há nada novo. O código e as imagens vêm
de `/api/updates/files/...` (URLs relativas ao manifesto) e o app confere o SHA-256 de cada arquivo antes de usar.

Cada publicação fica numa pasta própria, com nome começando pela data e hora (UTC), e vale a mais recente. Ela tem o
`manifest.json` (ou o `directive.json`, na volta ao código do APK), o código, as imagens e o `publicacao.json` (mensagem,
data e quem publicou, só para consulta). O script extrai numa pasta com ponto no início, que a API ignora, e só então
renomeia, então o celular nunca vê uma publicação pela metade. Ficam as 15 mais recentes de cada runtime.

O APK e as atualizações não leem arquivos `.env`: o endereço da API fica no código. O `.env` local continua valendo no
Expo Go, e a tela de login ainda permite trocar o servidor.

### Chave de assinatura

Criada pelo `preparar-android.ps1` em `Documentos\EFFEX Trade - chave do app`: `effex-trade.jks` (a chave) e
`chave.properties` (senha, alias e o SHA-256). Todo APK precisa ser assinado com ela: com outra chave, o Android recusa
instalar por cima ("App não instalado") e cada usuário teria de desinstalar, perdendo o login e as posições ainda não
enviadas. Sem ela também não dá para registrar o app no Google (abaixo).

- **Cópia de segurança:** copie a pasta inteira para um pendrive guardado ou um cofre de senhas. Não envie por WhatsApp
  nem e-mail.
- **Outro computador:** coloque a pasta no mesmo lugar (`Documentos\EFFEX Trade - chave do app`) antes de gerar o APK.
- O `preparar-android.ps1` nunca cria outra chave se a pasta já existir. Se ela se perder depois do app distribuído,
  restaure a cópia; criar uma chave nova obriga todos a desinstalar o app.

Para conferir a chave: `keytool -list -v -keystore effex-trade.jks` (pede a senha do `chave.properties`) mostra o mesmo
SHA-256.

### Verificação de desenvolvedor do Google (prazo: 2027)

Desde 30/09/2026, o Google exige no Brasil desenvolvedor verificado só para apps instalados por lojas (Play Store,
Samsung, Xiaomi e outras). APK instalado direto, como este, ainda não é afetado. Em 2027 a exigência passa a valer para
todos os apps em celulares Android certificados; sem o registro, o APK deixa de instalar e de atualizar em celulares
novos. Antes disso:

1. Pedir o número **D-U-N-S** da empresa (gratuito, até 28 dias; desconfie de sites que cobram por ele).
2. Criar a conta completa no **Android Developer Console** (taxa de US$ 25; a conta gratuita "limitada" só vale para
   até 20 aparelhos).
3. Registrar o pacote `com.effex.trade` com o SHA-256 da chave (no `chave.properties`). Para pacote que já está em uso,
   o console pede um APK assinado com um arquivo de comprovação: coloque o arquivo e gere com `deploy\gerar-apk.ps1`.

Referência: https://developer.android.com/developer-verification

### Cuidados ao mexer no app

- Não renomeie `LOCATION_TASK` (`src/lib/tracking.ts`): o Android guarda a tarefa de localização por esse nome.
- Não peça permissões de SMS, leitura de notificações ou acessibilidade: o Play Protect bloqueia APK instalado fora de
  loja que as pede.
- Não rode `npx expo prebuild` em `apps/mobile`: o build usa a cópia em `C:\effex-apk`, e os scripts param se
  `apps/mobile/android` existir.
- Novas telas de fluxo (onde reiniciar perderia uma foto ou texto) ficam fora de `SAFE_ROUTES` em
  `src/lib/updates.ts`; só abas entram lá.
- Mudar `updates.url` no `app.json` (ex.: domínio novo) muda a parte nativa: precisa de APK novo, e os APKs antigos
  continuam pedindo atualização ao endereço antigo.

### Problemas comuns

| Problema | O que fazer |
|---|---|
| "App não instalado" ao instalar por cima | O APK é mais antigo que o instalado (build menor) ou foi assinado com outra chave. Use o APK mais novo de `apk\`. |
| Conta mostra "Ativo só com o app aberto" | A localização não está em "Permitir o tempo todo": Configurações > Apps > EFFEX Trade > Permissões > Localização. |
| A posição para de chegar com a tela desligada | Bateria do app em "Sem restrições" (passo 6 da mensagem). |
| `gerar-apk.ps1`: "Android SDK não preparado" ou "Chave de assinatura não encontrada" | Rode `preparar-android.ps1`; se o app já foi distribuído, restaure antes a cópia da pasta da chave. |
| `gerar-apk.ps1`: "A parte nativa da cópia difere da do projeto" | `npm ci` em `apps\mobile` e gere de novo. |
| `atualizar-app.ps1`: "Nenhum APK da pasta apk\ tem esta parte nativa" | A mudança precisa de APK novo (tabela acima). Se o APK foi gerado em outro computador, use `-Forcar`. |
| O app não recebe a atualização | Confira se a publicação está em `/opt/effex-trade/updates/android/<runtime>/` no VPS e se a API foi publicada com a rota `/updates`. |
| Build falha com caminho longo ("Filename longer than 260 characters") | O build precisa rodar na cópia em `C:\effex-apk` com `cmakeObjectPathMax=250` (veja [Como o build funciona](#como-o-build-funciona)); não mude `$pastaBuild` em `deploy/app-comum.ps1` para um caminho longo. Se uma biblioteca nova ainda estourar: habilite caminho longo no Windows (como administrador, `LongPathsEnabled=1` em `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`) e passe `-Pandroid.cmakeVersion=3.31.0` ao Gradle, cujo Ninja aceita caminho longo. |
