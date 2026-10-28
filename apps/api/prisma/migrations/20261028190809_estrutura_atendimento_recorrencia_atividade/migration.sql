-- CreateEnum
CREATE TYPE "VisitModule" AS ENUM ('FOTOS', 'ATIVIDADES', 'ESTOQUE');

-- CreateEnum
CREATE TYPE "TaskRecurrence" AS ENUM ('TODA_VISITA', 'PONTUAL', 'SEMANAL', 'QUINZENAL', 'MENSAL');

-- AlterTable
ALTER TABLE "RouteItem" ADD COLUMN     "modules" "VisitModule"[] DEFAULT ARRAY['FOTOS', 'ATIVIDADES']::"VisitModule"[];

-- AlterTable
ALTER TABLE "ScheduledVisit" ADD COLUMN     "modules" "VisitModule"[] DEFAULT ARRAY['FOTOS', 'ATIVIDADES']::"VisitModule"[];

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "recurrence" "TaskRecurrence" NOT NULL DEFAULT 'TODA_VISITA',
ADD COLUMN     "scheduledVisitId" TEXT,
ALTER COLUMN "endDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "modules" "VisitModule"[] DEFAULT ARRAY['FOTOS', 'ATIVIDADES']::"VisitModule"[],
ADD COLUMN     "stockConfirmedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_scheduledVisitId_fkey" FOREIGN KEY ("scheduledVisitId") REFERENCES "ScheduledVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
