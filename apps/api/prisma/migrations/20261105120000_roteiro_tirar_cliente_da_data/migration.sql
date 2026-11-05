-- CreateTable
CREATE TABLE "RouteSkip" (
    "id" TEXT NOT NULL,
    "promotorId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteSkip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteSkip_promotorId_date_idx" ON "RouteSkip"("promotorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RouteSkip_promotorId_clientId_date_key" ON "RouteSkip"("promotorId", "clientId", "date");

-- AddForeignKey
ALTER TABLE "RouteSkip" ADD CONSTRAINT "RouteSkip_promotorId_fkey" FOREIGN KEY ("promotorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteSkip" ADD CONSTRAINT "RouteSkip_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteSkip" ADD CONSTRAINT "RouteSkip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

