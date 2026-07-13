-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'MENUNGGU_PEMBAYARAN_DP', 'ANTREAN', 'CUTTING', 'PRINTING', 'EMBROIDERY', 'SEWING', 'FINISHING', 'IRONING', 'PACKING', 'SELESAI', 'MENUNGGU_PELUNASAN', 'LUNAS', 'DIKIRIM', 'DIBATALKAN');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "base_price_snapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sizes" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "ukuran" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_designs" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "file_url" TEXT,
    "catatan_teks" TEXT,
    "hasil_ekstraksi_ai" JSONB,
    "status_konfirmasi" TEXT NOT NULL DEFAULT 'MENUNGGU',
    "versi_revisi" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_materials" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "qty_required" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_services" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "lokasi" TEXT,
    "ukuran" TEXT,
    "tarif" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_timeline_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "tipe_event" TEXT NOT NULL,
    "deskripsi" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "order_materials_order_item_id_material_id_key" ON "order_materials"("order_item_id", "material_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sizes" ADD CONSTRAINT "order_sizes_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_designs" ADD CONSTRAINT "order_designs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_materials" ADD CONSTRAINT "order_materials_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_timeline_events" ADD CONSTRAINT "order_timeline_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
