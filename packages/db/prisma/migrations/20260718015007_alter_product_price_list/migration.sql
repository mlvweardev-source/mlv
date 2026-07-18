/*
  Warnings:

  - You are about to drop the column `snap_redirect_url` on the `payments` table. All the data in the column will be lost.
  - The primary key for the `product_price_list` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `product_price_list` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "product_price_list_product_type_key";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "snap_redirect_url";

-- AlterTable
ALTER TABLE "product_price_list" DROP CONSTRAINT "product_price_list_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "product_price_list_pkey" PRIMARY KEY ("product_type");
