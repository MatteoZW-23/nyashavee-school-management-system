-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "assessmentId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "exchangeRate" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

