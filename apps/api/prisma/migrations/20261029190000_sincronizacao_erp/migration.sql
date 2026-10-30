-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "erpId" INTEGER;

-- CreateTable
CREATE TABLE "ErpSync" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CLIENTES',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3),
    "total" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "inactivated" INTEGER NOT NULL,
    "reactivated" INTEGER NOT NULL,
    "linked" INTEGER NOT NULL,
    "unlocated" INTEGER NOT NULL,
    "ip" TEXT,

    CONSTRAINT "ErpSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErpSync_kind_receivedAt_idx" ON "ErpSync"("kind", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_erpId_key" ON "Client"("erpId");

