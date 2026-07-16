'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { INVOICE_STATUS_LABELS, type InvoiceRow, type InvoiceStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const INVOICE_BADGE: Record<InvoiceStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary',
  ISSUED: 'warning',
  PAID: 'success',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
};

/** Daftar invoice sistem-wide (Fase 9.3) — view + unduh PDF. */
export default function FinanceInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<InvoiceRow[]>('/invoices')
      .then(setInvoices)
      .catch((e) => setError(e instanceof Error ? e.message : 'Gagal memuat invoice'))
      .finally(() => setLoading(false));
  }, []);

  async function handleDownloadPdf(invoiceId: string) {
    setError(null);
    try {
      const { pdfUrl } = await apiFetch<{ pdfUrl: string }>(`/invoices/${invoiceId}/pdf`);
      window.open(pdfUrl.startsWith('http') ? pdfUrl : `${window.location.origin}${pdfUrl}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengambil PDF invoice');
    }
  }

  const visible = statusFilter ? invoices.filter((i) => i.status === statusFilter) : invoices;

  return (
    <div className="space-y-4">
      <Select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | '')}
        className="w-48"
      >
        <option value="">Semua status</option>
        {(Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map((s) => (
          <option key={s} value={s}>
            {INVOICE_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>

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
                <TableHead>Status</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>PDF</TableHead>
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
                    Tidak ada invoice
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-4 font-medium">
                      {inv.order ? (
                        <Link
                          href={`/orders/${inv.order.id}`}
                          className="text-primary hover:underline"
                        >
                          {inv.order.orderNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{inv.jenis}</TableCell>
                    <TableCell className="text-right">
                      Rp {inv.jumlah.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={INVOICE_BADGE[inv.status]}>
                        {INVOICE_STATUS_LABELS[inv.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(inv.createdAt).toLocaleString('id-ID')}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => handleDownloadPdf(inv.id)}>
                        <FileText className="h-3 w-3" /> Unduh
                      </Button>
                    </TableCell>
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
