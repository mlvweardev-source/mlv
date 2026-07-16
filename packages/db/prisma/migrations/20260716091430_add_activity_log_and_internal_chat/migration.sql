-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "deskripsi" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_chat_threads" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_chat_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "pesan" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_log_entity_type_entity_id_created_at_idx" ON "activity_log"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_log_created_at_idx" ON "activity_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "internal_chat_threads_order_id_key" ON "internal_chat_threads"("order_id");

-- CreateIndex
CREATE INDEX "internal_chat_messages_thread_id_created_at_idx" ON "internal_chat_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "internal_chat_threads" ADD CONSTRAINT "internal_chat_threads_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_chat_messages" ADD CONSTRAINT "internal_chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "internal_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
