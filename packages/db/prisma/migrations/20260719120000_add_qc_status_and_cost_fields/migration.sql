-- AlterTable: Add QC verification fields to production_tasks
ALTER TABLE "production_tasks" ADD COLUMN "qc_status" TEXT;
ALTER TABLE "production_tasks" ADD COLUMN "qc_reason" TEXT;
ALTER TABLE "production_tasks" ADD COLUMN "qc_by" TEXT;
ALTER TABLE "production_tasks" ADD COLUMN "qc_at" TIMESTAMP(3);

-- AlterTable: Add production cost estimate to production_routings
ALTER TABLE "production_routings" ADD COLUMN "estimasi_biaya_jahit_per_pcs" DOUBLE PRECISION DEFAULT 0;

-- Seed placeholder cost values (estimasi, bukan angka final dari bisnis)
UPDATE "production_routings" SET "estimasi_biaya_jahit_per_pcs" = 5000 WHERE "product_type" = 'Kaos';
UPDATE "production_routings" SET "estimasi_biaya_jahit_per_pcs" = 8000 WHERE "product_type" = 'Kemeja';
UPDATE "production_routings" SET "estimasi_biaya_jahit_per_pcs" = 10000 WHERE "product_type" = 'Hoodie';
UPDATE "production_routings" SET "estimasi_biaya_jahit_per_pcs" = 3000 WHERE "product_type" = 'Topi';
UPDATE "production_routings" SET "estimasi_biaya_jahit_per_pcs" = 7000 WHERE "product_type" = 'Tas';
