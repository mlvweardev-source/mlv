import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';

/**
 * Internal Chat — halaman pengantar (§11).
 *
 * Chat aktual berada di halaman detail order (`/orders/[id]`).
 * Halaman ini mengarahkan staff ke order yang relevan.
 *
 * RBAC: Owner & Manajer lihat semua thread; Penjahit hanya thread
 * order yang punya task assigned ke dirinya (filter di endpoint).
 */
export default function ChatPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Internal Chat</h1>
        <p className="text-sm text-muted-foreground">
          Chat internal per order — buka dari halaman detail order
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-8 text-center">
        <MessagesSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-30" />
        <h2 className="mb-1 text-lg font-medium">Chat tersedia di halaman Order</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Panel chat muncul di halaman detail setiap order. Buka order untuk melihat dan mengirim
          pesan.
        </p>
        <Link
          href="/orders"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          → Lihat Daftar Order
        </Link>
      </div>
    </div>
  );
}
