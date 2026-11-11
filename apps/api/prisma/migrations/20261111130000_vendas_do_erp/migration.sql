-- Vendas dos últimos 2 meses de cada cliente, vindas do ERP no mesmo pacote dos clientes (ErpSale, ErpSaleItem)

-- AlterTable
ALTER TABLE "ErpSync" ADD COLUMN     "sales" INTEGER,
ADD COLUMN     "salesFrom" DATE,
ADD COLUMN     "salesTo" DATE;

-- CreateTable
CREATE TABLE "ErpSale" (
    "id" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "invoice" TEXT,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ErpSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSaleItem" (
    "saleId" INTEGER NOT NULL,
    "productErpId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ErpSaleItem_pkey" PRIMARY KEY ("saleId","productErpId")
);

-- CreateIndex
CREATE INDEX "ErpSale_clientId_date_idx" ON "ErpSale"("clientId", "date");

-- AddForeignKey
ALTER TABLE "ErpSale" ADD CONSTRAINT "ErpSale_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSaleItem" ADD CONSTRAINT "ErpSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ErpSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
