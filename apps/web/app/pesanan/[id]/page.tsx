'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Loader2,
  PackageCheck,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Truck,
  Upload,
} from 'lucide-react';
import { API_URL, ApiError, apiFetch } from '@/lib/api';
import { formatDate, formatRupiah, OrderDetail, STATUS_LABELS } from '@/lib/order-types';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerChatPanel } from '@/components/chat-panel';
import { cn } from '@/lib/utils';

function eventLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [uploadItemId, setUploadItemId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState('');
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSent, setReviewSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setError(null);
    try {
      setOrder(await apiFetch<OrderDetail>(`/orders/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail pesanan');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  async function uploadRevision(event: FormEvent) {
    event.preventDefault();
    if (!uploadItemId || !uploadFile) return;
    setBusyAction(`upload-${uploadItemId}`);
    setNotice(null);
    const formData = new FormData();
    formData.append('file', uploadFile);
    if (uploadNote.trim()) formData.append('catatanTeks', uploadNote.trim());
    try {
      const response = await fetch(`${API_URL}/orders/${id}/items/${uploadItemId}/designs`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(response.status, body?.message ?? 'Upload revisi gagal');
      }
      setUploadItemId(null);
      setUploadFile(null);
      setUploadNote('');
      setNotice('Revisi desain berhasil ditambahkan sebagai versi baru.');
      await loadOrder();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Upload revisi gagal');
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDesign(designId: string, status: 'DITERIMA' | 'DITOLAK') {
    setBusyAction(`confirm-${designId}`);
    setNotice(null);
    try {
      await apiFetch(`/orders/${id}/designs/${designId}/confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusKonfirmasi: status }),
      });
      setNotice(
        status === 'DITERIMA'
          ? 'Hasil analisis AI desain diterima.'
          : 'Hasil analisis AI desain ditolak.',
      );
      await loadOrder();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal mengkonfirmasi desain');
    } finally {
      setBusyAction(null);
    }
  }

  async function downloadInvoice(invoiceId: string) {
    setBusyAction(`invoice-${invoiceId}`);
    setNotice(null);
    try {
      const { pdfUrl } = await apiFetch<{ pdfUrl: string }>(`/invoices/${invoiceId}/pdf`);
      window.open(`${API_URL}${pdfUrl}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Invoice gagal diunduh');
    } finally {
      setBusyAction(null);
    }
  }

  async function repeatOrder() {
    if (!order) return;
    setBusyAction('repeat');
    setNotice(null);
    try {
      const draft = await apiFetch<OrderDetail>(`/orders/${order.id}/duplicate`, {
        method: 'POST',
      });
      router.push(`/pesan?draft=${draft.id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Repeat order gagal dibuat');
      setBusyAction(null);
    }
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    setBusyAction('review');
    setNotice(null);
    try {
      await apiFetch(`/customers/${order.customerId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, rating, komentar: reviewComment || undefined }),
      });
      setReviewSent(true);
      setNotice('Terima kasih. Review Anda berhasil dikirim.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Review gagal dikirim');
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat detail pesanan...
      </div>
    );
  }

  if (error || !order) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <Link href="/pesanan" className={cn(buttonVariants({ variant: 'outline' }), 'mb-6')}>
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Link>
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      </main>
    );
  }

  const canRepeat = order.status === 'DIKIRIM' || order.status === 'DIBATALKAN';
  const canReview = order.status === 'DIKIRIM' && !reviewSent;

  return (
    <main className="mx-auto max-w-7xl px-4 py-7 sm:py-10">
      <Link
        href="/pesanan"
        className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" /> Riwayat pesanan
      </Link>

      <header className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>{STATUS_LABELS[order.status] ?? order.status}</Badge>
            <span className="text-sm text-muted-foreground">
              Dibuat {formatDate(order.createdAt)}
            </span>
          </div>
          <h1 className="text-2xl font-bold sm:text-3xl">{order.orderNumber}</h1>
        </div>
        {canRepeat && (
          <Button onClick={repeatOrder} disabled={busyAction === 'repeat'} className="min-h-11">
            {busyAction === 'repeat' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Repeat Order
          </Button>
        )}
      </header>

      {notice && (
        <div className="mb-6 border-l-4 border-foreground bg-muted px-4 py-3 text-sm" role="status">
          {notice}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
        <div className="space-y-10">
          <section aria-labelledby="items-heading">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="items-heading" className="text-xl font-semibold">
                Item & Desain
              </h2>
              <span className="text-sm text-muted-foreground">{order.items.length} item</span>
            </div>
            <div className="space-y-4">
              {order.items.map((item) => {
                const qty = item.sizes.reduce((sum, size) => sum + size.qty, 0);
                const isUploadOpen = uploadItemId === item.id;
                return (
                  <Card key={item.id} className="rounded-md shadow-none">
                    <CardHeader className="border-b p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">{item.productType}</CardTitle>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {qty} pcs x {formatRupiah(item.basePriceSnapshot)}
                          </p>
                        </div>
                        {item.designRevision.allowed ? (
                          <Button
                            variant="outline"
                            className="min-h-11"
                            onClick={() => setUploadItemId(isUploadOpen ? null : item.id)}
                          >
                            <Upload className="h-4 w-4" /> Upload Revisi
                          </Button>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 p-5">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                          Ukuran
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {item.sizes.map((size) => (
                            <Badge key={size.id} variant="outline">
                              {size.ukuran}: {size.qty}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {item.services.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                            Layanan
                          </p>
                          <div className="space-y-1 text-sm">
                            {item.services.map((service) => (
                              <div key={service.id} className="flex justify-between gap-4">
                                <span>
                                  {service.serviceType}
                                  {service.lokasi ? ` - ${service.lokasi}` : ''}
                                </span>
                                <span>{formatRupiah(service.tarif)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                          Riwayat versi desain
                        </p>
                        {item.designs.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Belum ada file desain.</p>
                        ) : (
                          <div className="divide-y border-y">
                            {[...item.designs]
                              .sort((a, b) => b.versiRevisi - a.versiRevisi)
                              .map((design) => (
                                <div key={design.id} className="py-3 text-sm">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <p className="font-medium">Versi {design.versiRevisi}</p>
                                      <p className="truncate text-muted-foreground">
                                        {design.catatanTeks || 'Tanpa catatan'}
                                      </p>
                                    </div>
                                    {design.fileUrl && (
                                      <a
                                        href={`${API_URL}${design.fileUrl}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4"
                                      >
                                        <FileText className="h-4 w-4" /> Buka
                                      </a>
                                    )}
                                  </div>

                                  {/* Fase 12: Hasil Analisis AI */}
                                  {design.hasilEkstraksiAi && (
                                    <div className="mt-3 rounded-lg border bg-muted/30 p-3 space-y-2">
                                      <p className="text-xs font-semibold uppercase text-primary flex items-center gap-1">
                                        <Sparkles className="h-3 w-3" /> Analisis AI
                                      </p>
                                      {(() => {
                                        const ai = design.hasilEkstraksiAi as Record<
                                          string,
                                          unknown
                                        >;
                                        const warna = ai.warna as
                                          Record<string, unknown> | undefined;
                                        const warnaKain = warna?.kain ? String(warna.kain) : null;
                                        const warnaAksen = warna?.aksen
                                          ? String(warna.aksen)
                                          : null;
                                        const lokasi = ai.lokasi_print as
                                          Array<Record<string, unknown>> | undefined;
                                        const kompleksitas = ai.estimasi_kompleksitas as
                                          string | undefined;
                                        const saran = ai.saran_untuk_pelanggan as
                                          string | undefined;
                                        return (
                                          <div className="space-y-1 text-xs">
                                            {warnaKain && (
                                              <p>
                                                <span className="font-medium">Warna kain:</span>{' '}
                                                {warnaKain}
                                              </p>
                                            )}
                                            {warnaAksen && (
                                              <p>
                                                <span className="font-medium">Warna aksen:</span>{' '}
                                                {warnaAksen}
                                              </p>
                                            )}
                                            {lokasi && lokasi.length > 0 && (
                                              <div>
                                                <p className="font-medium">Lokasi print:</p>
                                                <ul className="ml-3 list-disc">
                                                  {lokasi.map((l, i) => (
                                                    <li key={i}>
                                                      {String(l.lokasi)} — {String(l.deskripsi)} (
                                                      {String(l.teknik)})
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}
                                            {kompleksitas && (
                                              <p>
                                                <span className="font-medium">Kompleksitas:</span>{' '}
                                                <Badge
                                                  variant={
                                                    kompleksitas === 'TINGGI'
                                                      ? 'destructive'
                                                      : kompleksitas === 'SEDANG'
                                                        ? 'default'
                                                        : 'secondary'
                                                  }
                                                >
                                                  {kompleksitas}
                                                </Badge>
                                              </p>
                                            )}
                                            {saran && (
                                              <p className="italic text-muted-foreground">
                                                Saran: {saran}
                                              </p>
                                            )}
                                          </div>
                                        );
                                      })()}

                                      {/* Confirm/Reject buttons */}
                                      {design.statusKonfirmasi === 'MENUNGGU' && (
                                        <div className="flex gap-2 pt-2">
                                          <Button
                                            size="sm"
                                            onClick={() => confirmDesign(design.id, 'DITERIMA')}
                                            disabled={busyAction === `confirm-${design.id}`}
                                            className="min-h-9"
                                          >
                                            <CheckCircle2 className="mr-1 h-3 w-3" /> Terima
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => confirmDesign(design.id, 'DITOLAK')}
                                            disabled={busyAction === `confirm-${design.id}`}
                                            className="min-h-9"
                                          >
                                            Tolak
                                          </Button>
                                        </div>
                                      )}
                                      {design.statusKonfirmasi === 'DITERIMA' && (
                                        <p className="text-xs text-green-600 flex items-center gap-1">
                                          <CheckCircle2 className="h-3 w-3" /> Diterima
                                        </p>
                                      )}
                                      {design.statusKonfirmasi === 'DITOLAK' && (
                                        <p className="text-xs text-red-600">Ditolak</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>

                      {!item.designRevision.allowed && (
                        <p className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          {item.designRevision.reason}
                        </p>
                      )}

                      {isUploadOpen && item.designRevision.allowed && (
                        <form onSubmit={uploadRevision} className="space-y-3 border-t pt-4">
                          <label
                            className="block text-sm font-medium"
                            htmlFor={`revision-${item.id}`}
                          >
                            File revisi
                          </label>
                          <input
                            id={`revision-${item.id}`}
                            type="file"
                            required
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                            className="block min-h-11 w-full rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2"
                          />
                          <label
                            className="block text-sm font-medium"
                            htmlFor={`revision-note-${item.id}`}
                          >
                            Catatan revisi
                          </label>
                          <textarea
                            id={`revision-note-${item.id}`}
                            value={uploadNote}
                            onChange={(event) => setUploadNote(event.target.value)}
                            rows={3}
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <Button
                            type="submit"
                            disabled={!uploadFile || busyAction === `upload-${item.id}`}
                            className="min-h-11"
                          >
                            {busyAction === `upload-${item.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                            Simpan Versi Baru
                          </Button>
                        </form>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="finance-heading">
            <h2 id="finance-heading" className="mb-4 text-xl font-semibold">
              Pembayaran & Invoice
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Riwayat pembayaran</h3>
                <div className="divide-y border-y">
                  {order.payments.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">Belum ada pembayaran.</p>
                  ) : (
                    order.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">{payment.jenis}</p>
                          <p className="text-muted-foreground">{formatDate(payment.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatRupiah(payment.jumlah)}</p>
                          <Badge variant="outline">{payment.status}</Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Invoice</h3>
                <div className="divide-y border-y">
                  {order.invoices.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">Belum ada invoice.</p>
                  ) : (
                    order.invoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">Invoice {invoice.jenis}</p>
                          <p className="text-muted-foreground">{formatRupiah(invoice.jumlah)}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          title="Unduh invoice PDF"
                          aria-label={`Unduh invoice ${invoice.jenis}`}
                          onClick={() => downloadInvoice(invoice.id)}
                          disabled={busyAction === `invoice-${invoice.id}`}
                        >
                          {busyAction === `invoice-${invoice.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          {canReview && (
            <section aria-labelledby="review-heading" className="border-t pt-8">
              <h2 id="review-heading" className="text-xl font-semibold">
                Beri Review
              </h2>
              <form onSubmit={submitReview} className="mt-4 max-w-2xl space-y-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Rating</legend>
                  <div className="flex gap-1" role="group">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRating(value)}
                        aria-label={`${value} bintang`}
                        aria-pressed={rating === value}
                        className="flex h-11 w-11 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Star
                          className={cn(
                            'h-5 w-5',
                            value <= rating
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-muted-foreground',
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="block text-sm font-medium" htmlFor="review-comment">
                  Komentar
                </label>
                <textarea
                  id="review-comment"
                  rows={4}
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" disabled={busyAction === 'review'} className="min-h-11">
                  {busyAction === 'review' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}{' '}
                  Kirim Review
                </Button>
              </form>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          {order.shipment && (
            <section className="border-y py-5" aria-labelledby="shipment-heading">
              <div className="mb-4 flex items-center gap-2">
                <Truck className="h-5 w-5" />
                <h2 id="shipment-heading" className="font-semibold">
                  Pengiriman
                </h2>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Kurir</dt>
                <dd className="text-right font-medium">{order.shipment.kurir}</dd>
                <dt className="text-muted-foreground">No. resi</dt>
                <dd className="break-all text-right font-medium">
                  {order.shipment.noResi ?? 'Belum tersedia'}
                </dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-right font-medium">{eventLabel(order.shipment.status)}</dd>
                <dt className="text-muted-foreground">Diperbarui</dt>
                <dd className="text-right">{formatDate(order.shipment.updatedAt)}</dd>
              </dl>
            </section>
          )}

          <section aria-labelledby="timeline-heading">
            <div className="mb-5 flex items-center gap-2">
              <Clock3 className="h-5 w-5" />
              <h2 id="timeline-heading" className="font-semibold">
                Live Tracking
              </h2>
            </div>
            <ol className="relative ml-2 border-l pl-6">
              {[...order.timeline].reverse().map((event, index) => (
                <li key={event.id} className="relative pb-7 last:pb-0">
                  <span
                    className={cn(
                      'absolute -left-[31px] top-0 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background',
                      index === 0 ? 'bg-foreground' : 'bg-muted-foreground',
                    )}
                  />
                  <p className="text-sm font-semibold">{eventLabel(event.tipeEvent)}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{event.deskripsi}</p>
                  <time className="mt-1 block text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          </section>

          {order.status === 'DIKIRIM' && reviewSent && (
            <div className="flex items-start gap-3 border-y py-4 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span>Review sudah dikirim untuk pesanan ini.</span>
            </div>
          )}
          {order.status === 'DIKIRIM' && <PackageCheck className="sr-only" />}
        </aside>
      </div>

      <section aria-labelledby="chat-heading" className="mt-10">
        <h2 id="chat-heading" className="mb-3 text-xl font-semibold">
          Butuh bantuan?
        </h2>
        <CustomerChatPanel orderId={order.id} />
      </section>
    </main>
  );
}
