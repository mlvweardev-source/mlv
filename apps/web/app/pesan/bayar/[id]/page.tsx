'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertCircle, ExternalLink, ArrowLeft, Home } from 'lucide-react';

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
}

export default function BayarPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const orderId = params.id as string;
  const snapUrl = searchParams.get('snap_url');

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Polling order status
  useEffect(() => {
    if (!orderId) return;

    let isMounted = true;
    let pollInterval: NodeJS.Timeout;

    const fetchOrder = async () => {
      try {
        const data = await apiFetch<OrderDetail>(`/orders/${orderId}`);
        if (isMounted) {
          setOrder(data);
          setError(null);
          setLoading(false);

          // Stop polling if the status moves out of MENUNGGU_PEMBAYARAN_DP
          if (data.status !== 'MENUNGGU_PEMBAYARAN_DP') {
            clearInterval(pollInterval);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Gagal mengambil detail pesanan');
          setLoading(false);
        }
      }
    };

    fetchOrder();
    
    // Poll every 3 seconds
    pollInterval = setInterval(fetchOrder, 3000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [orderId]);

  const handlePayNow = () => {
    if (snapUrl) {
      window.location.href = snapUrl;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'secondary';
      case 'MENUNGGU_PEMBAYARAN_DP': return 'destructive';
      case 'ANTREAN': return 'default';
      default: return 'outline';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'Draf';
      case 'MENUNGGU_PEMBAYARAN_DP': return 'Menunggu Pembayaran DP';
      case 'ANTREAN': return 'Dalam Antrean Produksi';
      case 'DIBATALKAN': return 'Dibatalkan';
      default: return status;
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4">
        <Card className="w-full text-center py-8">
          <CardContent className="space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Memuat detail transaksi...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4">
        <Card className="w-full text-center py-8 border-destructive/20 shadow-md">
          <CardHeader>
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <CardTitle className="text-lg mt-4">Kesalahan Terjadi</CardTitle>
            <CardDescription className="text-sm mt-2">{error || 'Pesanan tidak ditemukan.'}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => router.push('/pesan')} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4 py-8">
      {order.status === 'MENUNGGU_PEMBAYARAN_DP' ? (
        <Card className="w-full shadow-lg border-primary/10">
          <CardHeader className="text-center bg-muted/40 rounded-t-xl py-6">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary mb-4" />
            <CardTitle className="text-xl font-bold">Menunggu Pembayaran DP</CardTitle>
            <CardDescription className="text-sm mt-2">
              Segera selesaikan pembayaran DP Anda untuk memulai proses produksi.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-6 space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Nomor Order:</span>
                <span className="font-bold">{order.orderNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status Order:</span>
                <Badge variant={getStatusBadgeVariant(order.status)}>
                  {getStatusLabel(order.status)}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tanggal:</span>
                <span className="font-medium">{new Date(order.createdAt).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 leading-normal">
              Sistem sedang memantau pembayaran Anda secara real-time. Halaman ini akan otomatis berganti setelah pembayaran berhasil.
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2 rounded-b-xl border-t bg-muted/10 py-4">
            {snapUrl && (
              <Button onClick={handlePayNow} className="w-full py-6 font-bold shadow-md">
                Bayar Sekarang <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            )}
            <Button onClick={() => router.push('/pesan')} variant="outline" className="w-full">
              Kembali ke Pemesanan
            </Button>
          </CardFooter>
        </Card>
      ) : order.status === 'ANTREAN' ? (
        <Card className="w-full shadow-lg border-emerald-500/20">
          <CardHeader className="text-center bg-emerald-50/50 rounded-t-xl py-6">
            <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto mb-4 animate-bounce" />
            <CardTitle className="text-2xl font-extrabold text-emerald-800">Pembayaran Sukses!</CardTitle>
            <CardDescription className="text-sm mt-1 text-emerald-700/80">
              DP Pembayaran 50% berhasil kami terima.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-6 space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Nomor Order:</span>
                <span className="font-bold">{order.orderNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status Terbaru:</span>
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">
                  {getStatusLabel(order.status)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-normal mt-4">
                Pesanan Anda telah dimasukkan ke dalam antrean produksi. Tim kami akan segera memproses cutting dan penjahitan sesuai detail spesifikasi Anda.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2 rounded-b-xl border-t bg-muted/10 py-4">
            <Button onClick={() => router.push('/')} className="w-full py-5 font-bold shadow-md flex items-center justify-center gap-2">
              <Home className="h-4 w-4" /> Ke Halaman Utama
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card className="w-full shadow-lg border-muted-foreground/10">
          <CardHeader className="text-center py-6">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <CardTitle className="text-xl font-bold">Status Transaksi</CardTitle>
            <CardDescription className="text-sm mt-2">
              Order Anda berstatus: <strong>{getStatusLabel(order.status)}</strong>.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => router.push('/')} variant="outline">
              Kembali ke Beranda
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
