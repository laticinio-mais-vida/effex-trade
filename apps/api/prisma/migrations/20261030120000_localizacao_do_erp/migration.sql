-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('ERP', 'PAINEL');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "locationSource" "LocationSource";

-- AlterTable
ALTER TABLE "ErpSync" ADD COLUMN     "located" INTEGER NOT NULL DEFAULT 0;

-- Localizações que já existem foram cadastradas no painel (ou pela planilha): a sincronização com o ERP não as muda
UPDATE "Client" SET "locationSource" = 'PAINEL' WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
