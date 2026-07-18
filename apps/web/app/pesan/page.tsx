'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RepeatOrderReview } from '@/components/repeat-order-review';
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ShoppingCart,
  Loader2,
  Upload,
  FileText,
  Sparkles,
} from 'lucide-react';

interface Me {
  id: string;
  actorType: string;
  nama: string;
}

const PRODUCT_PRICES: Record<string, number> = {
  Kaos: 85000,
  Kemeja: 120000,
  Hoodie: 150000,
  Topi: 45000,
  Tas: 60000,
};

const AVAILABLE_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

export default function PesanPage() {
  const router = useRouter();

  // Auth state
  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Form states
  const [productType, setProductType] = useState('Kaos');
  const [sizes, setSizes] = useState<Record<string, number>>({
    S: 0,
    M: 0,
    L: 0,
    XL: 0,
    XXL: 0,
  });
  const [catatanTeks, setCatatanTeks] = useState('');
  const [designFile, setDesignFile] = useState<File | null>(null);

  // Services
  const [useSablon, setUseSablon] = useState(false);
  const [sablonLokasi, setSablonLokasi] = useState('Dada Depan');
  const [useBordir, setUseBordir] = useState(false);
  const [bordirLokasi, setBordirLokasi] = useState('Dada Depan');

  // Confirmation
  const [confirmed, setConfirmed] = useState(false);

  // Real-time stock state
  const [stockStatus, setStockStatus] = useState<{
    available: boolean;
    estimation?: string;
  } | null>(null);
  const [checkingStock, setCheckingStock] = useState(false);

  // Checkout loading stages
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutStage, setCheckoutStage] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [repeatDraftId, setRepeatDraftId] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);

  // 1. Check Auth state & Restore draft if any
  useEffect(() => {
    const draftId = new URLSearchParams(window.location.search).get('draft');
    if (draftId) setRepeatDraftId(draftId);

    apiFetch<Me>('/auth/me')
      .then((data) => setMe(data.actorType === 'CUSTOMER' ? data : null))
      .catch(() => setMe(null))
      .finally(() => setAuthChecked(true));

    // Restore draft from localStorage
    const savedDraft = localStorage.getItem('mlv_order_builder_draft');
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        if (draft.productType) setProductType(draft.productType);
        if (draft.sizes) setSizes(draft.sizes);
        if (draft.catatanTeks) setCatatanTeks(draft.catatanTeks);
        if (draft.useSablon !== undefined) setUseSablon(draft.useSablon);
        if (draft.sablonLokasi) setSablonLokasi(draft.sablonLokasi);
        if (draft.useBordir !== undefined) setUseBordir(draft.useBordir);
        if (draft.bordirLokasi) setBordirLokasi(draft.bordirLokasi);
        localStorage.removeItem('mlv_order_builder_draft');
      } catch (e) {
        console.error('Gagal restore order draft', e);
      }
    }
  }, []);

  // 2. Calculate totals
  const basePrice = PRODUCT_PRICES[productType] || 0;
  const totalQty = Object.values(sizes).reduce((a, b) => a + b, 0);

  let serviceChargePerPcs = 0;
  if (useSablon) serviceChargePerPcs += 15000;
  if (useBordir) serviceChargePerPcs += 20000;

  const subtotal = totalQty * basePrice;
  const serviceTotal = totalQty * serviceChargePerPcs;
  const totalPrice = subtotal + serviceTotal;
  const dpPrice = totalPrice * 0.5;

  // 3. Real-time Stock Check when productType or quantities change
  useEffect(() => {
    if (totalQty <= 0) {
      setStockStatus(null);
      return;
    }

    const timer = setTimeout(() => {
      setCheckingStock(true);
      apiFetch<{ available: boolean; estimation?: string }>(
        `/orders/check-availability?productType=${encodeURIComponent(productType)}&qty=${totalQty}`,
      )
        .then((res) => {
          setStockStatus(res);
        })
        .catch(() => {
          setStockStatus({ available: false, estimation: 'Gagal mengecek ketersediaan bahan' });
        })
        .finally(() => {
          setCheckingStock(false);
        });
    }, 500); // debounce 500ms

    return () => clearTimeout(timer);
  }, [productType, totalQty]);

  const handleQtyChange = (size: string, val: string) => {
    const qty = parseInt(val, 10) || 0;
    setSizes((prev) => ({
      ...prev,
      [size]: Math.max(0, qty),
    }));
  };

  const handleCheckout = async () => {
    if (totalQty <= 0) {
      alert('Kuantitas pesanan harus lebih dari 0');
      return;
    }

    // Save draft to localStorage and redirect to login if not logged in
    if (!me) {
      const draft = {
        productType,
        sizes,
        catatanTeks,
        useSablon,
        sablonLokasi,
        useBordir,
        bordirLokasi,
      };
      localStorage.setItem('mlv_order_builder_draft', JSON.stringify(draft));
      router.push('/login?from=/pesan');
      return;
    }

    if (!confirmed) {
      alert('Anda harus mengkonfirmasi desain dan spesifikasi pesanan terlebih dahulu.');
      return;
    }

    setIsSubmitting(true);
    setCheckoutError(null);

    try {
      // Step 1: Create Draft Order
      setCheckoutStage('Membuat draf pesanan...');
      const order = await apiFetch<{ id: string; orderNumber: string }>('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: me.id,
        }),
      });

      const orderId = order.id;

      // Step 2: Add Item
      setCheckoutStage('Menambahkan item pesanan...');
      const sizePayload = Object.entries(sizes)
        .filter(([_, qty]) => qty > 0)
        .map(([ukuran, qty]) => ({ ukuran, qty }));

      const item = await apiFetch<{ id: string }>(`/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productType,
          basePriceSnapshot: 0, // Auto-filled by backend at checkout
          sizes: sizePayload,
          catatanTeks: catatanTeks || undefined,
        }),
      });

      const itemId = item.id;

      // Step 3: Upload Design File if selected
      if (designFile) {
        setCheckoutStage('Mengunggah file desain & analisis AI...');
        const formData = new FormData();
        formData.append('file', designFile);
        if (catatanTeks) {
          formData.append('catatanTeks', catatanTeks);
        }

        // We use fetch directly since apiFetch does JSON by default
        const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
        const response = await fetch(`${API_URL}/orders/${orderId}/items/${itemId}/designs`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Gagal mengunggah file desain');
        }

        // Capture AI analysis result (Fase 12)
        const designData = await response.json();
        if (designData?.hasilEkstraksiAi) {
          setAiResult(designData.hasilEkstraksiAi as Record<string, unknown>);
        }
      }

      // Step 4: Add Services if selected
      if (useSablon) {
        setCheckoutStage('Menambahkan layanan sablon...');
        await apiFetch(`/orders/${orderId}/items/${itemId}/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceType: 'Sablon',
            lokasi: sablonLokasi,
            tarif: 15000,
          }),
        });
      }

      if (useBordir) {
        setCheckoutStage('Menambahkan layanan bordir...');
        await apiFetch(`/orders/${orderId}/items/${itemId}/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceType: 'Bordir',
            lokasi: bordirLokasi,
            tarif: 20000,
          }),
        });
      }

      // Step 5: Transition Order Status to MENUNGGU_PEMBAYARAN_DP (Triggers Atomic Stock Reservation)
      setCheckoutStage('Memproses reservasi bahan...');
      try {
        await apiFetch(`/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'MENUNGGU_PEMBAYARAN_DP',
          }),
        });
      } catch (err: any) {
        // Clear message if stock reservation fails
        throw new Error(err.message || 'Reservasi bahan gagal karena stok tidak mencukupi.');
      }

      // Step 6: Create Midtrans Payment Link for DP 50%
      setCheckoutStage('Menyiapkan halaman pembayaran...');
      const paymentResult = await apiFetch<{ midtransRedirectUrl: string }>('/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          jenis: 'DP',
          metode: 'midtrans_snap',
        }),
      });

      // Step 7: Redirect to Midtrans Snap Sandbox page
      setCheckoutStage('Mengalihkan ke Midtrans...');
      if (paymentResult.midtransRedirectUrl) {
        // Before redirect, send user to our waiting page which will redirect them or poll
        router.push(
          `/pesan/bayar/${orderId}?snap_url=${encodeURIComponent(paymentResult.midtransRedirectUrl)}`,
        );
      } else {
        throw new Error('Gagal mendapatkan tautan pembayaran Midtrans');
      }
    } catch (error: any) {
      console.error(error);
      setCheckoutError(error.message || 'Terjadi kesalahan saat memproses checkout.');
      setIsSubmitting(false);
    }
  };

  if (repeatDraftId) {
    return <RepeatOrderReview orderId={repeatDraftId} />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl bg-gradient-to-r from-primary to-muted-foreground bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-amber-500 animate-pulse" /> Order Builder
          </h1>
          <p className="text-muted-foreground mt-2">
            Rancang dan kustomisasi pakaian pesanan Anda secara real-time.
          </p>
        </div>
        {me && (
          <Badge
            variant="secondary"
            className="px-3 py-1.5 self-start md:self-center text-sm font-medium"
          >
            Sesi Aktif: {me.nama}
          </Badge>
        )}
      </div>

      {isSubmitting ? (
        <Card className="max-w-md mx-auto py-12 text-center border-primary/20 shadow-lg">
          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">{checkoutStage}</h3>
              <p className="text-sm text-muted-foreground">
                Mohon tidak menutup halaman ini selama pesanan sedang diproses.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Configurator Form */}
          <div className="lg:col-span-2 space-y-6">
            {checkoutError && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardHeader className="py-4 flex flex-row items-center gap-3">
                  <AlertCircle className="h-6 w-6 text-destructive flex-shrink-0" />
                  <div>
                    <CardTitle className="text-base text-destructive font-bold">
                      Checkout Gagal
                    </CardTitle>
                    <CardDescription className="text-destructive/80 mt-1">
                      {checkoutError}
                    </CardDescription>
                  </div>
                </CardHeader>
              </Card>
            )}

            {/* Step 1: Product Type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                    1
                  </span>
                  Pilih Produk
                </CardTitle>
                <CardDescription>Pilih jenis pakaian yang ingin Anda pesan.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {Object.keys(PRODUCT_PRICES).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setProductType(type)}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center transition-all ${
                        productType === type
                          ? 'border-primary bg-primary/5 ring-1 ring-primary font-semibold'
                          : 'border-border bg-card hover:border-muted-foreground/30'
                      }`}
                    >
                      <span className="text-sm font-medium">{type}</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        Rp {PRODUCT_PRICES[type].toLocaleString('id-ID')}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Sizes and Quantities */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                    2
                  </span>
                  Kuantitas Per Ukuran
                </CardTitle>
                <CardDescription>Tentukan jumlah pesanan per ukuran pakaian.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {AVAILABLE_SIZES.map((size) => (
                    <div key={size} className="space-y-2">
                      <label className="text-sm font-medium block text-center bg-muted py-1 rounded-md">
                        Ukuran {size}
                      </label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={sizes[size] || ''}
                        onChange={(e) => handleQtyChange(size, e.target.value)}
                        className="text-center font-semibold"
                      />
                    </div>
                  ))}
                </div>

                {/* Stock Check Indicator */}
                {totalQty > 0 && (
                  <div className="mt-6 p-4 rounded-xl border flex items-center gap-4 transition-all">
                    {checkingStock ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Mengecek ketersediaan bahan baku...
                        </span>
                      </>
                    ) : stockStatus ? (
                      stockStatus.available ? (
                        <>
                          <CheckCircle2 className="h-6 w-6 text-emerald-500 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-emerald-600">
                              Bahan Baku Tersedia
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {stockStatus.estimation || 'Siap masuk antrean produksi.'}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-amber-700">Stok Tidak Mencukupi</p>
                            <p className="text-xs text-amber-800">
                              {stockStatus.estimation || 'Beberapa bahan untuk produk ini kurang.'}
                            </p>
                          </div>
                        </>
                      )
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 3: Design & Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                    3
                  </span>
                  Desain & Catatan
                </CardTitle>
                <CardDescription>
                  Upload sketsa desain dan berikan catatan detail spesifikasi.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Unggah File Desain (JPG, PNG, PDF - Max 10MB)
                  </label>
                  <div className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center hover:bg-muted/50 transition-colors relative">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(e) => setDesignFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    {designFile ? (
                      <div className="text-center space-y-2">
                        <FileText className="h-10 w-10 text-primary mx-auto" />
                        <p className="text-sm font-semibold text-foreground">{designFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(designFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : (
                      <div className="text-center space-y-2">
                        <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                        <p className="text-sm text-foreground font-medium">
                          Klik atau tarik file ke sini untuk mengunggah
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Format yang didukung: JPEG, PNG, WebP, PDF
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Catatan Teks / Detail Tambahan</label>
                  <textarea
                    rows={4}
                    value={catatanTeks}
                    onChange={(e) => setCatatanTeks(e.target.value)}
                    placeholder="Contoh: Warna kain biru Navy, kancing warna kontras hitam, benang jahit senada..."
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Fase 12: AI Design Analysis Result */}
            {aiResult && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Hasil Analisis AI
                  </CardTitle>
                  <CardDescription>
                    Berikut hasil analisis otomatis dari desain Anda. Ini hanya saran — silakan
                    review sebelum melanjutkan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {(() => {
                    const warna = aiResult.warna as Record<string, unknown> | undefined;
                    const warnaKain = warna?.kain ? String(warna.kain) : '-';
                    const warnaAksen = warna?.aksen ? String(warna.aksen) : null;
                    const lokasi = aiResult.lokasi_print as
                      Array<Record<string, unknown>> | undefined;
                    const kompleksitas = aiResult.estimasi_kompleksitas as string | undefined;
                    const saran = aiResult.saran_untuk_pelanggan as string | undefined;
                    return (
                      <>
                        {warna && (
                          <div>
                            <p className="font-medium">Warna:</p>
                            <p className="text-muted-foreground">
                              Kain: {warnaKain}
                              {warnaAksen && <> | Aksen: {warnaAksen}</>}
                            </p>
                          </div>
                        )}
                        {lokasi && lokasi.length > 0 && (
                          <div>
                            <p className="font-medium">Lokasi Print:</p>
                            <ul className="ml-4 list-disc text-muted-foreground">
                              {lokasi.map((l, i) => (
                                <li key={i}>
                                  {String(l.lokasi)} — {String(l.deskripsi)} ({String(l.teknik)})
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {kompleksitas && (
                          <div>
                            <p className="font-medium">Estimasi Kompleksitas:</p>
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
                          </div>
                        )}
                        {saran && (
                          <div>
                            <p className="font-medium">Saran:</p>
                            <p className="text-muted-foreground italic">{saran}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Step 4: Additional Services */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                    4
                  </span>
                  Layanan Tambahan (Opsional)
                </CardTitle>
                <CardDescription>
                  Tambahkan layanan sablon atau bordir sesuai kebutuhan Anda.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Sablon Option */}
                <div
                  className={`p-4 rounded-xl border transition-all ${useSablon ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="sablon"
                        checked={useSablon}
                        onChange={(e) => setUseSablon(e.target.checked)}
                        className="mt-1 accent-primary h-4.5 w-4.5"
                      />
                      <div>
                        <label htmlFor="sablon" className="text-sm font-bold block cursor-pointer">
                          Layanan Sablon
                        </label>
                        <span className="text-xs text-muted-foreground">+Rp 15.000 / pcs</span>
                      </div>
                    </div>
                  </div>
                  {useSablon && (
                    <div className="mt-4 pt-4 border-t border-dashed border-border/80 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground block">
                          Lokasi Sablon
                        </label>
                        <select
                          value={sablonLokasi}
                          onChange={(e) => setSablonLokasi(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        >
                          <option value="Dada Depan">Dada Depan</option>
                          <option value="Punggung Belakang">Punggung Belakang</option>
                          <option value="Lengan Kiri">Lengan Kiri</option>
                          <option value="Lengan Kanan">Lengan Kanan</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bordir Option */}
                <div
                  className={`p-4 rounded-xl border transition-all ${useBordir ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="bordir"
                        checked={useBordir}
                        onChange={(e) => setUseBordir(e.target.checked)}
                        className="mt-1 accent-primary h-4.5 w-4.5"
                      />
                      <div>
                        <label htmlFor="bordir" className="text-sm font-bold block cursor-pointer">
                          Layanan Bordir
                        </label>
                        <span className="text-xs text-muted-foreground">+Rp 20.000 / pcs</span>
                      </div>
                    </div>
                  </div>
                  {useBordir && (
                    <div className="mt-4 pt-4 border-t border-dashed border-border/80 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground block">
                          Lokasi Bordir
                        </label>
                        <select
                          value={bordirLokasi}
                          onChange={(e) => setBordirLokasi(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        >
                          <option value="Dada Depan">Dada Depan</option>
                          <option value="Punggung Belakang">Punggung Belakang</option>
                          <option value="Lengan Kiri">Lengan Kiri</option>
                          <option value="Lengan Kanan">Lengan Kanan</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Summary Card */}
          <div className="space-y-6">
            <Card className="sticky top-20 border-primary/10 shadow-md">
              <CardHeader className="bg-muted/40 rounded-t-xl">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-primary" /> Ringkasan Pesanan
                </CardTitle>
                <CardDescription>Estimasi biaya transparan sebelum checkout.</CardDescription>
              </CardHeader>
              <CardContent className="py-6 space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {productType} ({totalQty} pcs)
                  </span>
                  <span className="font-semibold">Rp {subtotal.toLocaleString('id-ID')}</span>
                </div>

                {(useSablon || useBordir) && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Layanan Tambahan
                    </p>
                    {useSablon && (
                      <div className="flex justify-between text-sm pl-2 border-l border-border">
                        <span className="text-muted-foreground">Sablon ({sablonLokasi})</span>
                        <span className="font-semibold">
                          Rp {(totalQty * 15000).toLocaleString('id-ID')}
                        </span>
                      </div>
                    )}
                    {useBordir && (
                      <div className="flex justify-between text-sm pl-2 border-l border-border">
                        <span className="text-muted-foreground">Bordir ({bordirLokasi})</span>
                        <span className="font-semibold">
                          Rp {(totalQty * 20000).toLocaleString('id-ID')}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="border-t pt-4 flex justify-between font-extrabold text-base">
                  <span>Total Harga</span>
                  <span>Rp {totalPrice.toLocaleString('id-ID')}</span>
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 space-y-1">
                  <div className="flex justify-between text-xs font-bold">
                    <span>DP default 50%</span>
                    <span>Rp {dpPrice.toLocaleString('id-ID')}</span>
                  </div>
                  <p className="text-[10px] text-amber-700/80 leading-normal">
                    Pembayaran DP 50% diwajibkan untuk men-trigger reservasi stok dan memulai
                    produksi.
                  </p>
                </div>

                {/* Design Manual Confirmation Checkbox */}
                {totalQty > 0 && (
                  <div className="border-t pt-4 space-y-3">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Konfirmasi Desain
                    </p>
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        id="confirm-design"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="mt-0.5 accent-primary h-4 w-4"
                      />
                      <label
                        htmlFor="confirm-design"
                        className="text-xs text-muted-foreground leading-normal cursor-pointer"
                      >
                        Saya mengkonfirmasi bahwa sketsa desain, kuantitas ukuran, dan jenis produk
                        di atas sudah sesuai.
                      </label>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="bg-muted/10 border-t rounded-b-xl py-4">
                <Button
                  onClick={handleCheckout}
                  disabled={totalQty <= 0 || (stockStatus !== null && !stockStatus.available)}
                  className="w-full py-6 text-sm font-bold tracking-wide shadow-md"
                >
                  {!me ? 'Masuk untuk Checkout' : 'Checkout & Bayar DP'}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
