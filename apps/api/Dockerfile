# API do EFFEX Trade no VPS (deploy/docker-compose.yml). Roda o TypeScript direto com tsx, como em desenvolvimento.
FROM node:24-bookworm-slim

# openssl: motor de migrações do Prisma. fontconfig + DejaVu: a faixa de data e hora gravada nas fotos (sharp),
# sem fonte o texto sai sem letras. tzdata: horário dos logs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 npm_config_update_notifier=false

COPY package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
# tsx e prisma são devDependencies e rodam em produção. O postinstall faz o "prisma generate" (src/generated/prisma);
# o DATABASE_URL de mentira só satisfaz o prisma.config.ts: nada conecta no build.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci --include=dev --no-audit --no-fund \
 && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=320
USER node
EXPOSE 3333
# Aplica as migrações pendentes e sobe a API. O exec deixa o node como processo principal, para receber o aviso de
# parada do Docker e encerrar os timers (server.ts). Uma réplica só: os timers não podem rodar em dobro.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node --import tsx src/server.ts"]
