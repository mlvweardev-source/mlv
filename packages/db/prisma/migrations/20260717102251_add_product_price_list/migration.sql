-- CreateTable
CREATE TABLE "product_price_list" (
    "id" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "harga_dasar_per_pcs" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_price_list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_price_list_product_type_key" ON "product_price_list"("product_type");
