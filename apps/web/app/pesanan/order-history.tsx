'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Loader2, PackageSearch, Search } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate, OrderListItem, STATUS_LABELS } from '@/lib/order-types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'DIBATALKAN') return 'destructive';
  if (status === 'DIKIRIM') return 'default';
  if (status === 'DRAFT') return 'outline';
  return 'secondary';
}

export function OrderHistory() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    apiFetch<OrderListItem[]>('/orders')
      .then(setOrders)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const visibleOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orders;
    return orders.filter(
      (order) =>
        order.orderNumber.toLowerCase().includes(normalized) ||
        (STATUS_LABELS[order.status] ?? order.status).toLowerCase().includes(normalized) ||
        order.itemSummary.some((item) => item.productType.toLowerCase().includes(normalized)),
    );
  }, [orders, query]);

  return (
    <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-8 sm:py-10">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm font-semibold text-muted-foreground">Portal pelanggan</p>
          <h1 className="text-3xl font-bold">Riwayat Pesanan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {orders.length} pesanan tersimpan di akun Anda.
          </p>
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Cari pesanan</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari nomor, status, atau item"
            className="h-11 pl-9"
          />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat pesanan...
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : visibleOrders.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center border-y text-center">
          <PackageSearch className="mb-4 h-10 w-10 text-muted-foreground" />
          <h2 className="font-semibold">Pesanan tidak ditemukan</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {orders.length === 0
              ? 'Pesanan yang sudah dibuat akan muncul di halaman ini.'
              : 'Coba kata kunci lain atau hapus pencarian.'}
          </p>
        </div>
      ) : (
        <div className="divide-y border-y">
          {visibleOrders.map((order) => (
            <Link
              key={order.id}
              href={`/pesanan/${order.id}`}
              className="group grid min-h-32 gap-4 px-1 py-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:px-4"
            >
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{order.orderNumber}</span>
                  <Badge variant={statusVariant(order.status)}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4" /> Dibuat {formatDate(order.createdAt)}
                </div>
              </div>

              <div className="min-w-0 text-sm">
                <p className="mb-1 font-medium">Ringkasan item</p>
                <p className="truncate text-muted-foreground">
                  {order.itemSummary.map((item) => `${item.productType} ${item.qty} pcs`).join(', ')}
                </p>
              </div>

              <span className="flex h-11 w-11 items-center justify-center justify-self-end rounded-md border bg-background transition-colors group-hover:bg-foreground group-hover:text-background">
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Buka detail pesanan</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
