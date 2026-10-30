-- AlterTable
ALTER TABLE "VisitSession" ADD COLUMN     "gpsEstimatedMeters" DOUBLE PRECISION,
ADD COLUMN     "gpsMeters" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WorkDay" ADD COLUMN     "gpsKmAt" TIMESTAMP(3),
ADD COLUMN     "gpsKmMode" TEXT;
