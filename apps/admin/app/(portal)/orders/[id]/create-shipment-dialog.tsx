'use client';

import { useState } from 'react';
import { Truck, X } from 'lucide-react';
import { apiJson } from '@/lib/api';
import type { OrderStatus, ShipmentRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Tombol "Kirim Pesanan" di /orders/[id] (Fase 9.3).
 * GATE LUNAS: hanya enabled saat order.status === 'LUNAS' — backend juga
 * menolak (400) kalau belum lunas (Fase 7); tombol disabled + keterangan
 * hanyalah lapisan UX.
 */
export function CreateShipmentDialog({
  orderId,
  orderStatus,
  onShipped,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  onShipped: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShipmentRow | null>(null);
  const [form, setForm] = useState({ kurir: '', noResi: '', alamat: '', biaya: '' });

  const isLunas = orderStatus === 'LUNAS';
  const alreadyShipped = orderStatus === 'DIKIRIM';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const shipment = await apiJson<ShipmentRow>('/shipments', 'POST', {
        orderId,
        kurir: form.kurir,
        noResi: form.noResi || undefined,
        alamatPengiriman: form.alamat || undefined,
        biayaKirim: form.biaya ? Number(form.biaya) : undefined,
      });
      setResult(shipment);
      await onShipped();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat shipment');
    } finally {
      setBusy(false);
    }
  }

  if (alreadyShipped) {
    return null; // sudah dikirim — tidak perlu tombol
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setOpen(true)} disabled={!isLunas}>
          <Truck className="h-4 w-4" /> Kirim Pesanan
        </Button>
        {!isLunas && (
          <span className="text-xs text-muted-foreground">
            Order harus berstatus Lunas dulu sebelum bisa dikirim
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && setOpen(false)}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold">Kirim Pesanan</h2>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} disabled={busy}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {result ? (
            <div className="space-y-2">
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                Shipment dibuat — status order menjadi Dikirim (via event).
              </p>
              <p className="text-sm">
                Token tracking publik untuk dibagikan ke pelanggan:{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{result.trackingToken}</code>
              </p>
              <div className="flex justify-end">
                <Button onClick={() => setOpen(false)}>Tutup</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">Kurir</label>
                <Input
                  required
                  value={form.kurir}
                  onChange={(e) => setForm({ ...form, kurir: e.target.value })}
                  placeholder="JNE / SiCepat / J&T"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  No. Resi (opsional — bisa diisi nanti)
                </label>
                <Input
                  value={form.noResi}
                  onChange={(e) => setForm({ ...form, noResi: e.target.value })}
                  placeholder="Nomor resi dari kurir"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Alamat Override (opsional)</label>
                <Input
                  value={form.alamat}
                  onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                  placeholder="Kosongkan untuk pakai alamat pelanggan"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Biaya Kirim (opsional, informasional)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.biaya}
                  onChange={(e) => setForm({ ...form, biaya: e.target.value })}
                  placeholder="mis. 25000"
                  disabled={busy}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Mengirim…' : 'Buat Shipment'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
