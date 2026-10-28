-- CreateTable
CREATE TABLE "VisitSession" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "checkinAt" TIMESTAMP(3) NOT NULL,
    "checkinLat" DOUBLE PRECISION,
    "checkinLng" DOUBLE PRECISION,
    "checkinAccuracy" DOUBLE PRECISION,
    "checkinDistance" DOUBLE PRECISION,
    "checkoutAt" TIMESTAMP(3),
    "checkoutLat" DOUBLE PRECISION,
    "checkoutLng" DOUBLE PRECISION,
    "checkoutDistance" DOUBLE PRECISION,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VisitSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotorSetting" (
    "promotorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotorSetting_pkey" PRIMARY KEY ("promotorId","key")
);

-- CreateIndex
CREATE INDEX "VisitSession_visitId_idx" ON "VisitSession"("visitId");

-- AddForeignKey
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotorSetting" ADD CONSTRAINT "PromotorSetting_promotorId_fkey" FOREIGN KEY ("promotorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Atendimentos existentes viram a primeira abertura (sessão) de cada visita
INSERT INTO "VisitSession" ("id", "visitId", "checkinAt", "checkinLat", "checkinLng", "checkinAccuracy", "checkinDistance",
                            "checkoutAt", "checkoutLat", "checkoutLng", "checkoutDistance", "autoClosed")
SELECT 'mig_' || "id", "id", "checkinAt", "checkinLat", "checkinLng", "checkinAccuracy", "checkinDistance",
       "checkoutAt", "checkoutLat", "checkoutLng", "checkoutDistance", "autoClosed"
FROM "Visit"
WHERE "checkinAt" IS NOT NULL;
