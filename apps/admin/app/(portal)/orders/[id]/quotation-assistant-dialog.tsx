'use client';

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { apiJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Dialog "Minta Saran Harga AI" (Fase 12 Bagian 2, §17.4).
 *
 * AI HANYA memberi saran range harga. Hasil WAJIB dikonfirmasi manusia
 * sebelum final — tidak ada auto-apply. Staf tetap yang input harga
 * akhir lewat approval "Harga Khusus" (Fase 5, §13).
 *
 * Hasil AI ditampilkan sebagai saran dengan range (low - high) per pcs
 * + total estimasi + alasan. Staf bisa lihat lalu memutuskan sendiri
 * apakah perlu approval khusus.
 */

interface QuotationSuggestion {
  harga_per_pcs: { low: number; high: number };
  total_estimasi: { low: number; high: number };
  alasan: string;
  faktor_pendorong_harga: string[];
  saran_untuk_staf: string | null;
}

interface QuotationAssistantDialogProps {
  orderId: string;
  items: Array<{
    id: string;
    productType: string;
    basePriceSnapshot: number;
    sizes: Array<{ id: string; ukuran: string; qty: number }>;
    designs?: Array<{ hasilEkstraksiAi?: Record<string, unknown> | null }>;
  }>;
}

export function QuotationAssistantDialog({ items }: QuotationAssistantDialogProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<QuotationSuggestion | null>(null);

  // Default selection: first item
  const [selectedItemId, setSelectedItemId] = useState(items[0]?.id ?? '');
  const [catatanStaf, setCatatanStaf] = useState('');

  const selectedItem = items.find((i) => i.id === selectedItemId);
  const totalQty = selectedItem?.sizes.reduce((sum, s) => sum + s.qty, 0) ?? 0;
  const complexity =
    (selectedItem?.designs?.[0]?.hasilEkstraksiAi?.estimasi_kompleksitas as
      'RENDAH' | 'SEDANG' | 'TINGGI' | undefined) ?? undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedItem) {
      setError('Pilih item terlebih dahulu');
      return;
    }
    if (totalQty <= 0) {
      setError('Item belum punya quantity (tambah ukuran dulu)');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await apiJson<{ saran_harga: QuotationSuggestion | null }>(
        '/ai-assistant/quotation',
        'POST',
        {
          productType: selectedItem.productType,
          qty: totalQty,
          complexity: complexity ?? null,
          catatanStaf: catatanStaf || undefined,
          basePriceReference: selectedItem.basePriceSnapshot || undefined,
        },
      );
      setSuggestion(result.saran_harga);
      if (!result.saran_harga) {
        setError(
          'AI tidak dapat memberi saran saat ini. Coba lagi nanti, atau gunakan harga standar dari price list.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal meminta saran AI');
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setSuggestion(null);
    setError(null);
    setCatatanStaf('');
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" /> Minta Saran Harga AI
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && setOpen(false)}
    >
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-primary" /> Saran Harga AI
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                AI hanya memberi saran. Harga final selalu Anda yang menentukan lewat approval.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} disabled={busy}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {!suggestion ? (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Item</label>
                <Select
                  value={selectedItemId}
                  onChange={(e) => {
                    setSelectedItemId(e.target.value);
                    setSuggestion(null);
                  }}
                  disabled={busy || items.length === 0}
                >
                  {items.length === 0 ? (
                    <option value="">Belum ada item</option>
                  ) : (
                    items.map((it) => {
                      const qty = it.sizes.reduce((sum, s) => sum + s.qty, 0);
                      return (
                        <option key={it.id} value={it.id}>
                          {it.productType} ({qty} pcs)
                        </option>
                      );
                    })
                  )}
                </Select>
              </div>

              {complexity && (
                <p className="text-xs text-muted-foreground">
                  Kompleksitas desain (dari Design Analyzer): <strong>{complexity}</strong>
                </p>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">Catatan tambahan (opsional)</label>
                <Input
                  value={catatanStaf}
                  onChange={(e) => setCatatanStaf(e.target.value)}
                  placeholder='mis. "Cotton combed 30s, sablon 4 warna"'
                  disabled={busy}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={busy || items.length === 0}>
                  {busy ? 'Meminta saran…' : 'Minta Saran'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Saran harga per pcs
                  </p>
                  <p className="mt-1 text-2xl font-bold text-primary">
                    Rp {suggestion.harga_per_pcs.low.toLocaleString('id-ID')}
                    <span className="mx-2 text-base text-muted-foreground">—</span>
                    Rp {suggestion.harga_per_pcs.high.toLocaleString('id-ID')}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Total estimasi ({totalQty} pcs)
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    Rp {suggestion.total_estimasi.low.toLocaleString('id-ID')}
                    <span className="mx-2 text-sm text-muted-foreground">—</span>
                    Rp {suggestion.total_estimasi.high.toLocaleString('id-ID')}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Alasan</p>
                  <p className="mt-1 text-sm">{suggestion.alasan}</p>
                </div>

                {suggestion.faktor_pendorong_harga.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Faktor pendorong harga
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {suggestion.faktor_pendorong_harga.map((f, i) => (
                        <Badge key={i} variant="secondary">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {suggestion.saran_untuk_staf && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <strong>Saran untuk staf:</strong> {suggestion.saran_untuk_staf}
                  </div>
                )}
              </div>

              <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
                <strong>⚠️ Penting:</strong> Ini hanya saran dari AI. Anda tetap yang menentukan
                harga final. Jika ingin menggunakan harga di luar <em>ProductPriceList</em>, ajukan
                approval <strong>Harga Khusus</strong> terlebih dahulu.
              </p>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleReset} disabled={busy}>
                  Tanya Lagi
                </Button>
                <Button onClick={() => setOpen(false)}>Tutup</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
