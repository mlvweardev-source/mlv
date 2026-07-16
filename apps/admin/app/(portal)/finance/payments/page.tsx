'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PAYMENT_STATUS_LABELS, type PaymentRow, type PaymentStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
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

const PAYMENT_BADGE: Record<PaymentStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PENDING: 'warning',
  SUCCESS: 'success',
  FAILED: 'destructive',
  EXPIRED: 'destructive',
  CANCELLED: 'secondary',
};

/**
 * Daftar payment sistem-wide (Fase 9.3) — view-only untuk semua di
 * halaman ini: buat link pembayaran cukup dari halaman Order (§5.1:
 * Manajer view-only di Finance; Owner pun buat payment dari konteks order).
 */
export default function FinancePaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PaymentRow[]>('/payments')
      .then(setPayments)
      .catch((e) => setError(e instanceof Error ? e.message : 'Gagal memuat payment'))
      .finally(() => setLoading(false));
  }, []);

  const visible = statusFilter ? payments.filter((p) => p.status === statusFilter) : payments;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | '')}
          className="w-48"
        >
          <option value="">Semua status</option>
          {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((s) => (
            <option key={s} value={s}>
              {PAYMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <p className="text-sm text-muted-foreground">
          Buat link pembayaran dari halaman detail Order
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Order</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead>Metode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dibuat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Tidak ada payment
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 font-medium">
                      {p.order ? (
                        <Link
                          href={`/orders/${p.order.id}`}
                          className="text-primary hover:underline"
                        >
                          {p.order.orderNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{p.jenis}</TableCell>
                    <TableCell className="text-right">
                      Rp {p.jumlah.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell>{p.metode}</TableCell>
                    <TableCell>
                      <Badge variant={PAYMENT_BADGE[p.status]}>
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(p.createdAt).toLocaleString('id-ID')}</TableCell>
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
