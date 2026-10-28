-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "routeOrderWaived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkDay" ADD COLUMN     "routeOrderWaived" BOOLEAN NOT NULL DEFAULT false;
