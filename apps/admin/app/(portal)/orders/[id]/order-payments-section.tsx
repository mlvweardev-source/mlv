'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, FileText, Plus } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import {
  PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  type CreatePaymentResult,
  type InvoiceRow,
  type PaymentRow,
  type PaymentStatus,
  type InvoiceStatus,
  type PaymentType,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const INVOICE_BADGE: Record<InvoiceStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary',
  ISSUED: 'warning',
  PAID: 'success',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
};

/**
 * Section Pembayaran di /orders/[id] (Fase 9.3):
 * riwayat payment + invoice order ini, tombol "Buat Link Pembayaran"
 * (DP custom per order — staff input jumlah eksplisit, keputusan Fase 5).
 * Link Snap Midtrans ditampilkan untuk dibagikan ke pelanggan.
 */
export function OrderPaymentsSection({ orderId, canAct }: { orderId: string; canAct: boolean }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snapUrl, setSnapUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<{ jenis: PaymentType; jumlah: string }>({
    jenis: 'DP',
    jumlah: '',
  });

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [paymentData, invoiceData] = await Promise.all([
        apiFetch<PaymentRow[]>(`/payments?orderId=${orderId}`),
        apiFetch<InvoiceRow[]>(`/invoices?orderId=${orderId}`),
      ]);
      setPayments(paymentData);
      setInvoices(invoiceData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat pembayaran');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreatePayment(e: React.FormEvent) {
    e.preventDefault();
    const jumlah = Number(form.jumlah);
    if (!jumlah || jumlah <= 0) {
      setError('Jumlah harus lebih dari 0');
      return;
    }
    setBusy(true);
    setError(null);
    setSnapUrl(null);
    try {
      const result = await apiJson<CreatePaymentResult>('/payments', 'POST', {
        orderId,
        jenis: form.jenis,
        metode: 'midtrans_snap',
        jumlah,
      });
      if (result.midtransRedirectUrl) {
        setSnapUrl(result.midtransRedirectUrl);
      }
      setForm({ jenis: 'DP', jumlah: '' });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat payment');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard tidak tersedia — biarkan user copy manual dari teks
    }
  }

  async function handleDownloadPdf(invoiceId: string) {
    setError(null);
    try {
      const { pdfUrl } = await apiFetch<{ pdfUrl: string }>(`/invoices/${invoiceId}/pdf`);
      window.open(pdfUrl.startsWith('http') ? pdfUrl : `${window.location.origin}${pdfUrl}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengambil PDF invoice');
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Pembayaran</CardTitle>
        {canAct && (
          <Button
            variant={showForm ? 'outline' : 'default'}
            size="sm"
            onClick={() => setShowForm(!showForm)}
            disabled={busy}
          >
            <Plus className="h-4 w-4" /> Buat Link Pembayaran
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        {snapUrl && (
          <div className="space-y-1 rounded-md border border-green-300 bg-green-50 px-3 py-2">
            <p className="text-sm font-medium text-green-800">
              Link pembayaran Midtrans Snap berhasil dibuat — bagikan ke pelanggan:
            </p>
            <div className="flex items-center gap-2">
              <a
                href={snapUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-primary hover:underline"
              >
                {snapUrl}
              </a>
              <Button variant="outline" size="sm" onClick={() => void handleCopy(snapUrl)}>
                <Copy className="h-3 w-3" /> {copied ? 'Tersalin!' : 'Salin'}
              </Button>
            </div>
          </div>
        )}

        {canAct && showForm && (
          <form onSubmit={handleCreatePayment} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Jenis</label>
              <Select
                value={form.jenis}
                onChange={(e) => setForm({ ...form, jenis: e.target.value as PaymentType })}
                className="w-40"
                disabled={busy}
              >
                <option value="DP">DP</option>
                <option value="PELUNASAN">Pelunasan</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Jumlah (Rp) — DP custom per order</label>
              <Input
                required
                type="number"
                min="1"
                value={form.jumlah}
                onChange={(e) => setForm({ ...form, jumlah: e.target.value })}
                placeholder="mis. 500000"
                className="w-48"
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Membuat…' : 'Generate Link Snap'}
            </Button>
          </form>
        )}

        {/* Riwayat payment */}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Riwayat Payment
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada payment</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dibuat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.jenis}</TableCell>
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
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Invoice terkait */}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Invoice</p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Memuat…</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada invoice</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.jenis}</TableCell>
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
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
