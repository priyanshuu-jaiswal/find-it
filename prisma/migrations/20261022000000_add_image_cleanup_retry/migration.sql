-- AlterTable
ALTER TABLE "report_images" ADD COLUMN IF NOT EXISTS "cleanup_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "report_images" ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_images_cleanup_idx" ON "report_images"("next_retry_at", "created_at");
