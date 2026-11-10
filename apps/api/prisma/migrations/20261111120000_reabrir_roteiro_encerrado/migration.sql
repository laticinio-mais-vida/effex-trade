-- Roteiro reaberto pelo promotor depois de encerrado (WorkDayReopen): o intervalo é pausa no relatório

-- CreateTable
CREATE TABLE "WorkDayReopen" (
    "id" TEXT NOT NULL,
    "workDayId" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3) NOT NULL,
    "reopenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitId" TEXT,

    CONSTRAINT "WorkDayReopen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkDayReopen_workDayId_idx" ON "WorkDayReopen"("workDayId");

-- AddForeignKey
ALTER TABLE "WorkDayReopen" ADD CONSTRAINT "WorkDayReopen_workDayId_fkey" FOREIGN KEY ("workDayId") REFERENCES "WorkDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

