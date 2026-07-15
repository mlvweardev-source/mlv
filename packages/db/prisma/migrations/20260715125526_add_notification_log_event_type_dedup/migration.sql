-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "dedup_key" TEXT,
ADD COLUMN     "event_type" TEXT;

-- CreateIndex
CREATE INDEX "notification_logs_dedup_key_idx" ON "notification_logs"("dedup_key");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_created_at_idx" ON "notification_logs"("user_id", "created_at");
