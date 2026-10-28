-- Cadastro do cliente reduzido a nome fantasia, razão social, cidade, UF e localização.
-- Promotores, vendedores e supervisores passam a ter cidades (ou UFs) atendidas, que substituem o vendedor do cliente.

-- CreateTable
CREATE TABLE "UserArea" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT,

    CONSTRAINT "UserArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserArea_userId_idx" ON "UserArea"("userId");

-- AddForeignKey
ALTER TABLE "UserArea" ADD CONSTRAINT "UserArea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cliente: razão social, chave da cidade e localização opcional (clientes vindos do banco chegam sem coordenadas)
ALTER TABLE "Client" ADD COLUMN "legalName" TEXT,
ADD COLUMN "cityKey" TEXT,
ALTER COLUMN "latitude" DROP NOT NULL,
ALTER COLUMN "longitude" DROP NOT NULL;

-- O nome do cliente passa a ser o nome fantasia; o nome antigo (razão social / nome) vai para a razão social.
-- cityKey = cidade sem acento e em minúsculas, igual a cityKey() em src/lib/cities.ts
UPDATE "Client" SET
  "legalName" = "name",
  "name" = COALESCE(NULLIF(TRIM("tradeName"), ''), "name"),
  "city" = NULLIF(TRIM(REGEXP_REPLACE("city", '\s+', ' ', 'g')), ''),
  "state" = NULLIF(UPPER(TRIM("state")), '');
UPDATE "Client" SET "cityKey" = LOWER(TRANSLATE("city",
  'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
  'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
WHERE "city" IS NOT NULL;

-- Cidades de cada usuário a partir do que ele já via: promotor = clientes do roteiro fixo,
-- vendedor = clientes ligados a ele, supervisor = cidades da equipe
INSERT INTO "UserArea" ("id", "userId", "state", "city")
SELECT gen_random_uuid()::text, x."userId", x."state", x."city"
FROM (
  SELECT DISTINCT ON (r."promotorId", c."state", c."cityKey") r."promotorId" AS "userId", c."state", c."city"
  FROM "RouteItem" r JOIN "Client" c ON c."id" = r."clientId"
  WHERE c."state" IS NOT NULL AND c."cityKey" IS NOT NULL
  UNION ALL
  SELECT DISTINCT ON (c."sellerId", c."state", c."cityKey") c."sellerId", c."state", c."city"
  FROM "Client" c
  WHERE c."sellerId" IS NOT NULL AND c."state" IS NOT NULL AND c."cityKey" IS NOT NULL
) x;

INSERT INTO "UserArea" ("id", "userId", "state", "city")
SELECT gen_random_uuid()::text, x."supervisorId", x."state", x."city"
FROM (
  SELECT DISTINCT ON (u."supervisorId", a."state", c."cityKey") u."supervisorId", a."state", a."city", c."cityKey"
  FROM "UserArea" a
  JOIN "User" u ON u."id" = a."userId"
  JOIN LATERAL (SELECT LOWER(TRANSLATE(a."city",
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')) AS "cityKey") c ON TRUE
  WHERE u."supervisorId" IS NOT NULL
) x;

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_sellerId_fkey";

-- DropIndex
DROP INDEX "Client_code_key";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "address",
DROP COLUMN "code",
DROP COLUMN "document",
DROP COLUMN "geofenceRadius",
DROP COLUMN "sellerId",
DROP COLUMN "tradeName";

-- CreateIndex
CREATE INDEX "Client_state_cityKey_idx" ON "Client"("state", "cityKey");
