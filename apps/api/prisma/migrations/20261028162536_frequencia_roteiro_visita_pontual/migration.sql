-- CreateEnum
CREATE TYPE "RouteFrequency" AS ENUM ('SEMANAL', 'QUINZENAL', 'MENSAL', 'DIAS', 'SEMANAS');

-- AlterEnum
ALTER TYPE "VisitOrigin" ADD VALUE 'PONTUAL';

-- AlterTable
ALTER TABLE "RouteItem" ADD COLUMN     "frequency" "RouteFrequency" NOT NULL DEFAULT 'SEMANAL',
ADD COLUMN     "interval" INTEGER,
ADD COLUMN     "startDate" DATE;

-- CreateTable
CREATE TABLE "ScheduledVisit" (
    "id" TEXT NOT NULL,
    "promotorId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitId" TEXT,

    CONSTRAINT "ScheduledVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledVisit_visitId_key" ON "ScheduledVisit"("visitId");

-- CreateIndex
CREATE INDEX "ScheduledVisit_date_idx" ON "ScheduledVisit"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledVisit_promotorId_clientId_date_key" ON "ScheduledVisit"("promotorId", "clientId", "date");

-- AddForeignKey
ALTER TABLE "ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_promotorId_fkey" FOREIGN KEY ("promotorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
