'use client';

import { useState } from 'react';
import { BadgeCheck, X } from 'lucide-react';
import { apiJson } from '@/lib/api';
import { APPROVAL_TYPE_LABELS, type ApprovalType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Tombol + dialog "Ajukan Approval" di /orders/[id] (Fase 9.3, §13).
 * Manajer/Owner pilih tipe (Harga Khusus/Diskon/Edit Invoice/Refund),
 * refId terkait (item/invoice — dropdown sesuai tipe), catatan →
 * POST /approvals. Keputusan tetap di inbox /approvals (Owner).
 */
export function SubmitApprovalDialog({
  orderId,
  items,
  invoices,
  onSubmitted,
}: {
  orderId: string;
  items: Array<{ id: string; label: string }>;
  invoices: Array<{ id: string; label: string }>;
  onSubmitted: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tipe, setTipe] = useState<ApprovalType>('DISKON');
  const [refId, setRefId] = useState('');
  const [alasan, setAlasan] = useState('');

  // Referensi per tipe (§13): HARGA_KHUSUS → order item;
  // EDIT_INVOICE → invoice; DISKON/REFUND → order itu sendiri.
  const refOptions = tipe === 'HARGA_KHUSUS' ? items : tipe === 'EDIT_INVOICE' ? invoices : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiJson('/approvals', 'POST', {
        tipe,
        orderId,
        // DISKON & REFUND beroperasi pada order — refId = orderId
        refId: refOptions ? refId || undefined : orderId,
        alasan: alasan || undefined,
      });
      setSuccess(true);
      setAlasan('');
      setRefId('');
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
      }, 1500);
      await onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengajukan approval');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BadgeCheck className="h-4 w-4" /> Ajukan Approval
      </Button>
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
            <h2 className="text-lg font-semibold">Ajukan Approval</h2>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} disabled={busy}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {success ? (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Approval diajukan — menunggu keputusan Owner di inbox Approval.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">Tipe</label>
                <Select
                  value={tipe}
                  onChange={(e) => {
                    setTipe(e.target.value as ApprovalType);
                    setRefId('');
                  }}
                  disabled={busy}
                >
                  {(Object.keys(APPROVAL_TYPE_LABELS) as ApprovalType[]).map((t) => (
                    <option key={t} value={t}>
                      {APPROVAL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>

              {refOptions && (
                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    {tipe === 'HARGA_KHUSUS' ? 'Item terkait' : 'Invoice terkait'}
                  </label>
                  <Select
                    required
                    value={refId}
                    onChange={(e) => setRefId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">Pilih…</option>
                    {refOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  {refOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Belum ada {tipe === 'HARGA_KHUSUS' ? 'item' : 'invoice'} di order ini
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Catatan{tipe === 'DISKON' ? ' (mis. "Rp 50000" atau "10%")' : ''}
                </label>
                <Input
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                  placeholder={tipe === 'DISKON' ? 'Rp 50000' : 'Alasan/detail pengajuan'}
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
                  {busy ? 'Mengajukan…' : 'Ajukan'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
