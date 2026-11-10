-- Contestações de fotos reprovadas pelo promotor (PhotoContest) e cliente dispensado da cerca eletrônica

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('PENDENTE', 'ACEITA', 'NEGADA');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "geofenceExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geofenceExemptAt" TIMESTAMP(3),
ADD COLUMN     "geofenceExemptById" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "checkinWithoutGeofence" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PhotoContest" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "promotorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'PENDENTE',
    "response" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoContest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotoContest_photoId_key" ON "PhotoContest"("photoId");

-- CreateIndex
CREATE INDEX "PhotoContest_promotorId_createdAt_idx" ON "PhotoContest"("promotorId", "createdAt");

-- CreateIndex
CREATE INDEX "PhotoContest_status_idx" ON "PhotoContest"("status");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_geofenceExemptById_fkey" FOREIGN KEY ("geofenceExemptById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoContest" ADD CONSTRAINT "PhotoContest_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoContest" ADD CONSTRAINT "PhotoContest_promotorId_fkey" FOREIGN KEY ("promotorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoContest" ADD CONSTRAINT "PhotoContest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

