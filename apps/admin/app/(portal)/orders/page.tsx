'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ORDER_STATUSES, type OrderListItem, type OrderStatus } from '@/lib/types';
import { OrderStatusBadge, statusLabel } from '@/components/order-status-badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (statusFilter: OrderStatus | '', searchTerm: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (searchTerm) params.set('search', searchTerm);
      const qs = params.toString();
      const data = await apiFetch<OrderListItem[]>(`/orders${qs ? `?${qs}` : ''}`);
      setOrders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat order');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce pencarian 300ms
  useEffect(() => {
    const t = setTimeout(() => void loadOrders(status, search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [status, search, loadOrders]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Order</h1>
        <p className="text-sm text-muted-foreground">Daftar semua pesanan</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari nomor order…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-8"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
          className="w-56"
        >
          <option value="">Semua status</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Nomor Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Jumlah Item</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Dibuat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Tidak ada order ditemukan
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/orders/${order.id}`} className="text-primary hover:underline">
                        {order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell>{order._count?.items ?? 0}</TableCell>
                    <TableCell>
                      {order.deadline ? new Date(order.deadline).toLocaleDateString('id-ID') : '—'}
                    </TableCell>
                    <TableCell>{new Date(order.createdAt).toLocaleDateString('id-ID')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
