-- Desvios de tempo registrados na hora (relatório de tempos), com a justificativa do promotor e o ciente do supervisor

-- CreateTable
CREATE TABLE "TimeFlag" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "promotorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "valueSeconds" INTEGER NOT NULL,
    "baseSeconds" INTEGER NOT NULL,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "promotorNotified" BOOLEAN NOT NULL DEFAULT true,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justification" TEXT,
    "justifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,

    CONSTRAINT "TimeFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeFlag_visitId_kind_key" ON "TimeFlag"("visitId", "kind");

-- CreateIndex
CREATE INDEX "TimeFlag_date_idx" ON "TimeFlag"("date");

-- CreateIndex
CREATE INDEX "TimeFlag_promotorId_date_idx" ON "TimeFlag"("promotorId", "date");

-- CreateIndex
CREATE INDEX "TimeFlag_acknowledgedAt_idx" ON "TimeFlag"("acknowledgedAt");

-- AddForeignKey
ALTER TABLE "TimeFlag" ADD CONSTRAINT "TimeFlag_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeFlag" ADD CONSTRAINT "TimeFlag_promotorId_fkey" FOREIGN KEY ("promotorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeFlag" ADD CONSTRAINT "TimeFlag_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
