-- CreateEnum
CREATE TYPE "CustomerChatSenderType" AS ENUM ('customer', 'admin', 'ai_bot');

-- CreateTable
CREATE TABLE "customer_chat_threads" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_chat_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_type" "CustomerChatSenderType" NOT NULL,
    "sender_id" TEXT,
    "pesan" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_chat_threads_order_id_key" ON "customer_chat_threads"("order_id");

-- CreateIndex
CREATE INDEX "customer_chat_messages_thread_id_created_at_idx" ON "customer_chat_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "customer_chat_threads" ADD CONSTRAINT "customer_chat_threads_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_chat_threads" ADD CONSTRAINT "customer_chat_threads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_chat_messages" ADD CONSTRAINT "customer_chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "customer_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
