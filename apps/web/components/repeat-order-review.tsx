'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, FileText, Loader2, PackageCheck, Save } from 'lucide-react';
import { API_URL, apiFetch } from '@/lib/api';
import { formatRupiah, OrderDetail } from '@/lib/order-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const PRODUCT_PRICES: Record<string, number> = {
  Kaos: 85000,
  Kemeja: 120000,
  Hoodie: 150000,
  Topi: 45000,
  Tas: 60000,
};
const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

type EditableItem = {
  id: string;
  productType: string;
  sizes: Record<string, number>;
};

export function RepeatOrderReview({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'checkout' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OrderDetail>(`/orders/${orderId}`)
      .then((draft) => {
        if (draft.status !== 'DRAFT') throw new Error('Order repeat ini sudah bukan Draft.');
        setOrder(draft);
        setItems(
          draft.items.map((item) => ({
            id: item.id,
            productType: item.productType,
            sizes: Object.fromEntries(item.sizes.map((size) => [size.ukuran, size.qty])),
          })),
        );
      })
      .catch((err: Error) => setNotice(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const qty = Object.values(item.sizes).reduce((itemSum, value) => itemSum + value, 0);
        const services =
          order?.items
            .find((source) => source.id === item.id)
            ?.services.reduce((serviceSum, service) => serviceSum + service.tarif * qty, 0) ?? 0;
        return sum + qty * (PRODUCT_PRICES[item.productType] ?? 0) + services;
      }, 0),
    [items, order],
  );

  function sizesFor(item: EditableItem) {
    return [...new Set([...DEFAULT_SIZES, ...Object.keys(item.sizes)])];
  }

  function updateItem(itemId: string, update: Partial<EditableItem>) {
    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...update } : item)),
    );
  }

  function updateQty(itemId: string, size: string, value: string) {
    const qty = Math.max(0, Number.parseInt(value, 10) || 0);
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, sizes: { ...item.sizes, [size]: qty } } : item,
      ),
    );
  }

  async function persistItems() {
    for (const item of items) {
      const sizes = Object.entries(item.sizes)
        .filter(([, qty]) => qty > 0)
        .map(([ukuran, qty]) => ({ ukuran, qty }));
      if (sizes.length === 0) throw new Error('Setiap item harus memiliki minimal satu ukuran.');
      await apiFetch(`/orders/${orderId}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productType: item.productType, sizes }),
      });
    }
  }

  async function saveDraft() {
    setBusy('save');
    setNotice(null);
    try {
      await persistItems();
      setNotice('Perubahan Draft tersimpan. Harga menggunakan daftar harga terbaru.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Draft gagal disimpan');
    } finally {
      setBusy(null);
    }
  }

  async function checkout() {
    if (!confirmed) {
      setNotice('Konfirmasi item dan harga sebelum checkout ulang.');
      return;
    }
    setBusy('checkout');
    setNotice(null);
    try {
      await persistItems();
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'MENUNGGU_PEMBAYARAN_DP' }),
      });
      const payment = await apiFetch<{ midtransRedirectUrl: string }>('/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, jenis: 'DP', metode: 'midtrans_snap' }),
      });
      router.push(
        `/pesan/bayar/${orderId}?snap_url=${encodeURIComponent(payment.midtransRedirectUrl)}`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Checkout ulang gagal');
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat Draft repeat order...
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <Button
        variant="ghost"
        onClick={() => router.push(`/pesanan/${orderId}`)}
        className="mb-5 min-h-11 px-0 hover:bg-transparent"
      >
        <ArrowLeft className="h-4 w-4" /> Kembali ke detail
      </Button>
      <header className="mb-8 border-b pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">Draft Repeat Order</Badge>
          <span className="text-sm text-muted-foreground">{order?.orderNumber}</span>
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">Review & Edit Pesanan</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Periksa kembali produk, ukuran, desain, layanan, harga terbaru, dan ketersediaan stok
          sebelum checkout.
        </p>
      </header>

      {notice && (
        <div className="mb-6 border-l-4 border-foreground bg-muted px-4 py-3 text-sm" role="status">
          {notice}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
        <div className="space-y-5">
          {items.map((item, index) => {
            const source = order?.items.find((candidate) => candidate.id === item.id);
            return (
              <Card key={item.id} className="rounded-md shadow-none">
                <CardHeader className="border-b p-5">
                  <CardTitle className="text-base">Item {index + 1}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                  <div>
                    <label
                      htmlFor={`product-${item.id}`}
                      className="mb-2 block text-sm font-medium"
                    >
                      Jenis produk
                    </label>
                    <select
                      id={`product-${item.id}`}
                      value={item.productType}
                      onChange={(event) => updateItem(item.id, { productType: event.target.value })}
                      className="min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {Object.keys(PRODUCT_PRICES).map((product) => (
                        <option key={product}>{product}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Kuantitas per ukuran</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {sizesFor(item).map((size) => (
                        <label key={size} className="text-center text-xs text-muted-foreground">
                          {size}
                          <Input
                            type="number"
                            min="0"
                            value={item.sizes[size] || ''}
                            onChange={(event) => updateQty(item.id, size, event.target.value)}
                            className="mt-1 text-center text-sm"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        Layanan tersalin
                      </p>
                      {source?.services.length ? (
                        source.services.map((service) => (
                          <p key={service.id} className="text-sm">
                            {service.serviceType}
                            {service.lokasi ? ` - ${service.lokasi}` : ''}
                          </p>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Tanpa layanan tambahan</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        Desain terbaru
                      </p>
                      {source?.designs[0]?.fileUrl ? (
                        <a
                          href={`${API_URL}${source.designs[0].fileUrl}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4"
                        >
                          <FileText className="h-4 w-4" /> Buka desain
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">Tidak ada file desain</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <aside>
          <div className="sticky top-20 border-y py-5">
            <div className="mb-5 flex items-center gap-2">
              <PackageCheck className="h-5 w-5" />
              <h2 className="font-semibold">Ringkasan terbaru</h2>
            </div>
            <div className="space-y-3 text-sm">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{item.productType}</span>
                  <span>{Object.values(item.sizes).reduce((sum, qty) => sum + qty, 0)} pcs</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t pt-4">
              <span className="font-semibold">Estimasi total</span>
              <span className="font-bold">{formatRupiah(total)}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Total final dan stok divalidasi ulang oleh sistem saat checkout.
            </p>
            <label className="mt-5 flex items-start gap-3 border-t pt-4 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span>Saya sudah memeriksa item, ukuran, desain, layanan, dan estimasi harga.</span>
            </label>
            <div className="mt-5 grid gap-3">
              <Button
                variant="outline"
                onClick={saveDraft}
                disabled={busy !== null}
                className="min-h-11"
              >
                {busy === 'save' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}{' '}
                Simpan Draft
              </Button>
              <Button
                onClick={checkout}
                disabled={busy !== null || !confirmed}
                className="min-h-11"
              >
                {busy === 'checkout' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}{' '}
                Checkout & Bayar DP
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
