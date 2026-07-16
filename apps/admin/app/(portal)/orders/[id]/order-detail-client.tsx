'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, Upload } from 'lucide-react';
import { API_URL, apiFetch, apiJson } from '@/lib/api';
import type { StaffRole } from '@/lib/auth';
import type { InvoiceRow, OrderDetail, OrderStatus } from '@/lib/types';
import { OrderStatusBadge, statusLabel } from '@/components/order-status-badge';
import { OrderPaymentsSection } from './order-payments-section';
import { SubmitApprovalDialog } from './submit-approval-dialog';
import { CreateShipmentDialog } from './create-shipment-dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Transisi status yang diimplementasikan backend (Fase 3/6):
 * - DRAFT → MENUNGGU_PEMBAYARAN_DP (checkout, reservasi stok)
 * - MENUNGGU_PEMBAYARAN_DP → ANTREAN (konfirmasi manual)
 * - status apapun → DIBATALKAN
 */
function availableTransitions(status: OrderStatus): OrderStatus[] {
  const transitions: OrderStatus[] = [];
  if (status === 'DRAFT') transitions.push('MENUNGGU_PEMBAYARAN_DP');
  if (status === 'MENUNGGU_PEMBAYARAN_DP') transitions.push('ANTREAN');
  if (status !== 'DIBATALKAN' && status !== 'DIKIRIM') transitions.push('DIBATALKAN');
  return transitions;
}

export function OrderDetailClient({ orderId, role }: { orderId: string; role: StaffRole }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | ''>('');
  const [uploadItemId, setUploadItemId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // §5.1: Owner & Manajer full; Tim Penjahit view terbatas (tanpa aksi)
  const canAct = role === 'OWNER' || role === 'MANAJER_PRODUKSI';

  const loadOrder = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<OrderDetail>(`/orders/${orderId}`);
      setOrder(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat order');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  // Invoice order ini — untuk dropdown refId "Edit Invoice" di dialog approval
  const loadInvoices = useCallback(async () => {
    if (!canAct) return;
    try {
      const data = await apiFetch<InvoiceRow[]>(`/invoices?orderId=${orderId}`);
      setInvoices(data);
    } catch {
      setInvoices([]);
    }
  }, [orderId, canAct]);

  useEffect(() => {
    void loadOrder();
    void loadInvoices();
  }, [loadOrder, loadInvoices]);

  async function handleUpdateStatus() {
    if (!selectedStatus || !order) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiJson(`/orders/${order.id}/status`, 'PATCH', { status: selectedStatus });
      setSelectedStatus('');
      await loadOrder();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Gagal update status');
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate() {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      const newOrder = await apiJson<OrderDetail>(`/orders/${order.id}/duplicate`, 'POST');
      router.push(`/orders/${newOrder.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Gagal duplikasi order');
      setBusy(false);
    }
  }

  function triggerUpload(itemId: string) {
    setUploadItemId(itemId);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset supaya file sama bisa diupload ulang
    if (!file || !uploadItemId || !order) return;

    setBusy(true);
    setActionError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // FormData: browser set Content-Type multipart/form-data + boundary sendiri
      const response = await fetch(`${API_URL}/orders/${order.id}/items/${uploadItemId}/designs`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Upload gagal (${response.status})`);
      }
      await loadOrder();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Upload desain gagal');
    } finally {
      setBusy(false);
      setUploadItemId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Memuat…</p>;
  }

  if (error || !order) {
    return (
      <div className="space-y-4">
        <Link
          href="/orders"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali ke daftar order
        </Link>
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? 'Order tidak ditemukan'}
        </p>
      </div>
    );
  }

  const transitions = availableTransitions(order.status);

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/orders"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Daftar order
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{order.orderNumber}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Dibuat {new Date(order.createdAt).toLocaleString('id-ID')}
            {order.deadline &&
              ` · Deadline ${new Date(order.deadline).toLocaleDateString('id-ID')}`}
          </p>
        </div>

        {canAct && (
          <div className="flex flex-wrap items-center gap-2">
            {transitions.length > 0 && (
              <>
                <Select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value as OrderStatus | '')}
                  className="w-52"
                  disabled={busy}
                >
                  <option value="">Ubah status…</option>
                  {transitions.map((s) => (
                    <option key={s} value={s}>
                      → {statusLabel(s)}
                    </option>
                  ))}
                </Select>
                <Button onClick={handleUpdateStatus} disabled={!selectedStatus || busy}>
                  Terapkan
                </Button>
              </>
            )}
            <Button variant="outline" onClick={handleDuplicate} disabled={busy}>
              <Copy className="h-4 w-4" /> Repeat Order
            </Button>
            <SubmitApprovalDialog
              orderId={order.id}
              items={order.items.map((i) => ({ id: i.id, label: i.productType }))}
              invoices={invoices.map((inv) => ({
                id: inv.id,
                label: `${inv.jenis} — Rp ${inv.jumlah.toLocaleString('id-ID')}`,
              }))}
              onSubmitted={loadOrder}
            />
            <CreateShipmentDialog
              orderId={order.id}
              orderStatus={order.status}
              onShipped={loadOrder}
            />
          </div>
        )}
      </div>

      {actionError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Items */}
        <div className="space-y-4 lg:col-span-2">
          {order.items.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Belum ada item di order ini
              </CardContent>
            </Card>
          )}
          {order.items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>{item.productType}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Harga dasar: Rp {item.basePriceSnapshot.toLocaleString('id-ID')}
                  </p>
                </div>
                {canAct && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerUpload(item.id)}
                    disabled={busy}
                  >
                    <Upload className="h-4 w-4" /> Upload Desain
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Sizes */}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Ukuran
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {item.sizes.map((s) => (
                      <span key={s.id} className="rounded-md border px-2 py-1 text-sm">
                        {s.ukuran}: <strong>{s.qty}</strong> pcs
                      </span>
                    ))}
                  </div>
                </div>

                {/* Designs */}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Desain
                  </p>
                  {item.designs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada desain</p>
                  ) : (
                    <ul className="space-y-1">
                      {item.designs.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-sm">
                          {d.fileUrl ? (
                            <a
                              href={`${API_URL}${d.fileUrl}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {d.fileUrl.split('/').pop()}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">(catatan teks)</span>
                          )}
                          {d.catatanTeks && (
                            <span className="text-muted-foreground">— {d.catatanTeks}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            v{d.versiRevisi} · {d.statusKonfirmasi}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Materials (dari BOM otomatis saat checkout) */}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Material (BOM otomatis)
                  </p>
                  {item.materials.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Dihitung otomatis saat checkout</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Material</TableHead>
                          <TableHead className="text-right">Qty Dibutuhkan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.materials.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell>{m.materialNama || m.materialId}</TableCell>
                            <TableCell className="text-right">{m.qtyRequired}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Services */}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Layanan Tambahan
                  </p>
                  {item.services.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Tidak ada</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {item.services.map((s) => (
                        <li key={s.id}>
                          {s.serviceType}
                          {s.lokasi && ` · ${s.lokasi}`}
                          {s.ukuran && ` · ${s.ukuran}`} — Rp {s.tarif.toLocaleString('id-ID')}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Pembayaran & invoice (Fase 9.3) — §5.1: Penjahit ❌ Finance */}
          {canAct && <OrderPaymentsSection orderId={order.id} canAct={canAct} />}
        </div>

        {/* Timeline */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {order.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada event</p>
            ) : (
              <ol className="relative space-y-4 border-l pl-4">
                {order.timeline.map((t) => (
                  <li key={t.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                    <p className="text-sm font-medium">{t.tipeEvent}</p>
                    <p className="text-sm text-muted-foreground">{t.deskripsi}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleString('id-ID')}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
