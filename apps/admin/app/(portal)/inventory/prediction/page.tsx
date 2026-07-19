'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  RefreshCw,
  ShoppingCart,
  AlertTriangle,
  TrendingDown,
  CheckCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface InventoryPredictionItem {
  materialNama: string;
  materialId: string;
  status: 'KRITIS' | 'RENDAH' | 'AMAN';
  stok_saat_ini: number;
  free_stock: number;
  avg_per_day: number;
  estimasi_habis_hari: number;
  saran_qty_beli: number;
  satuan: string;
  alasan: string;
}

interface InventoryPredictionResult {
  prediksi: InventoryPredictionItem[];
  ringkasan: string;
  rekomendasi_umum: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'destructive' | 'warning' | 'success'; icon: typeof AlertTriangle }
> = {
  KRITIS: { label: 'Kritis', variant: 'destructive', icon: AlertTriangle },
  RENDAH: { label: 'Rendah', variant: 'warning', icon: TrendingDown },
  AMAN: { label: 'Aman', variant: 'success', icon: CheckCircle },
};

export default function InventoryPredictionPage() {
  const router = useRouter();
  const [prediction, setPrediction] = useState<InventoryPredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPrediction() {
    setLoading(true);
    setError(null);
    setPrediction(null);
    try {
      const result = await apiFetch<{ prediksi: InventoryPredictionResult | null }>(
        '/ai-assistant/inventory-prediction',
        { method: 'POST' },
      );
      setPrediction(result.prediksi);
      if (!result.prediksi) {
        setError('AI tidak tersedia saat ini. Coba lagi nanti.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat prediksi');
    } finally {
      setLoading(false);
    }
  }

  function handleCreatePO(item: InventoryPredictionItem) {
    const params = new URLSearchParams({
      materialId: item.materialId,
      qty: String(item.saran_qty_beli),
    });
    router.push(`/inventory/purchases?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Analisis tren pemakaian material dan prediksi kebutuhan restock menggunakan AI
        </p>
        <Button onClick={() => void loadPrediction()} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> Menganalisis…
            </>
          ) : (
            <>
              <Sparkles className="mr-1 h-4 w-4" /> Jalankan Prediksi
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {prediction && (
        <>
          {/* Ringkasan */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm">{prediction.ringkasan}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {prediction.rekomendasi_umum}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabel Prediksi */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Material</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Stok Bebas</TableHead>
                    <TableHead className="text-right">Rata/Hari</TableHead>
                    <TableHead className="text-right">Est. Habis</TableHead>
                    <TableHead className="text-right">Saran Beli</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prediction.prediksi.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        Tidak ada data prediksi
                      </TableCell>
                    </TableRow>
                  ) : (
                    prediction.prediksi
                      .sort((a, b) => {
                        const order = { KRITIS: 0, RENDAH: 1, AMAN: 2 };
                        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                      })
                      .map((item) => {
                        const config = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.AMAN;
                        const Icon = config.icon;
                        return (
                          <TableRow key={item.materialId}>
                            <TableCell className="pl-4 font-medium">{item.materialNama}</TableCell>
                            <TableCell>
                              <Badge variant={config.variant} className="gap-1">
                                <Icon className="h-3 w-3" />
                                {config.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {item.free_stock.toLocaleString('id-ID')} {item.satuan}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.avg_per_day.toFixed(1)} {item.satuan}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.estimasi_habis_hari === Infinity ||
                              item.estimasi_habis_hari > 999
                                ? '> 1 tahun'
                                : `${Math.round(item.estimasi_habis_hari)} hari`}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {item.saran_qty_beli > 0
                                ? `${item.saran_qty_beli.toLocaleString('id-ID')} ${item.satuan}`
                                : '—'}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                              {item.alasan}
                            </TableCell>
                            <TableCell>
                              {item.saran_qty_beli > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCreatePO(item)}
                                >
                                  <ShoppingCart className="mr-1 h-3 w-3" /> Buat PO
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-[10px] italic text-muted-foreground">
            Ini adalah saran AI — staf yang memutuskan material mana yang perlu direstock dan
            quantity-nya. Tidak ada Purchase Order yang dibuat otomatis.
          </p>
        </>
      )}

      {!prediction && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p>Klik &quot;Jalankan Prediksi&quot; untuk menganalisis kebutuhan restock material</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
