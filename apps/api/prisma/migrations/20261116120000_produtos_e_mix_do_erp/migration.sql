-- Produtos e mix vindos do ERP: o produto guarda o código interno do ERP (PRODUTOS.ID_PRODUTO), pelo qual a
-- sincronização dos clientes o atualiza e refaz o mix de cada cliente com as vendas dos últimos 2 meses

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "erpId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Product_erpId_key" ON "Product"("erpId");
