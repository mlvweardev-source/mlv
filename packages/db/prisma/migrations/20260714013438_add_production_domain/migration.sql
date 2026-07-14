-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CUTTING', 'PRINTING', 'EMBROIDERY', 'SEWING', 'FINISHING', 'IRONING', 'PACKING');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DITERIMA', 'MENUNGGU', 'SEDANG_DILAKSANAKAN', 'SELESAI');

-- CreateTable
CREATE TABLE "production_routings" (
    "id" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "urutan_task" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_routings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_tasks" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'DITERIMA',
    "assigned_to" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_routings_product_type_key" ON "production_routings"("product_type");

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
