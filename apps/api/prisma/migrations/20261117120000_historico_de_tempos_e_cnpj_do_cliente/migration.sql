-- Relatório de tempos: CPF/CNPJ no cliente (chave das medianas) e histórico de visitas importado do TradePro

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "document" TEXT;

-- CreateTable
CREATE TABLE "TimeHistory" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "promotorName" TEXT NOT NULL,
    "promotorId" TEXT,
    "supervisorName" TEXT,
    "clientKey" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "city" TEXT,
    "clientId" TEXT,
    "checkinAt" TIMESTAMP(3),
    "checkoutAt" TIMESTAMP(3),
    "clientSeconds" INTEGER NOT NULL DEFAULT 0,
    "travelSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT,
    "reason" TEXT,
    "comment" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_document_idx" ON "Client"("document");

-- CreateIndex
CREATE INDEX "TimeHistory_date_idx" ON "TimeHistory"("date");

-- CreateIndex
CREATE INDEX "TimeHistory_clientKey_date_idx" ON "TimeHistory"("clientKey", "date");

-- CreateIndex
CREATE INDEX "TimeHistory_promotorName_clientKey_idx" ON "TimeHistory"("promotorName", "clientKey");

-- CreateIndex
CREATE INDEX "TimeHistory_source_date_idx" ON "TimeHistory"("source", "date");
