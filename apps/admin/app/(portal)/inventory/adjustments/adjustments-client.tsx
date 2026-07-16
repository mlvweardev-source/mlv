'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import type { Material, StockAdjustmentRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export function AdjustmentsClient({ canAct }: { canAct: boolean }) {
  const [adjustments, setAdjustments] = useState<StockAdjustmentRow[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ materialId: '', qtyDelta: '', alasan: '' });

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [adjustmentData, materialData] = await Promise.all([
        apiFetch<StockAdjustmentRow[]>('/stock/adjustments'),
        apiFetch<Material[]>('/materials'),
      ]);
      setAdjustments(adjustmentData);
      setMaterials(materialData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat penyesuaian stok');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qtyDelta = Number(form.qtyDelta);
    if (!form.materialId || Number.isNaN(qtyDelta) || qtyDelta === 0) {
      setError('Material dan qty delta (bukan 0) wajib diisi');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiJson('/stock/adjustments', 'POST', {
        materialId: form.materialId,
        qtyDelta,
        alasan: form.alasan,
      });
      setForm({ materialId: '', qtyDelta: '', alasan: '' });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat penyesuaian');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canAct && (
        <div className="flex justify-end">
          <Button variant={showForm ? 'outline' : 'default'} onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" /> Buat Penyesuaian
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {canAct && showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Penyesuaian Stok Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Material</label>
                <Select
                  required
                  value={form.materialId}
                  onChange={(e) => setForm({ ...form, materialId: e.target.value })}
                  className="w-56"
                >
                  <option value="">Pilih material…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nama} ({m.satuan})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Qty Delta (+/−)</label>
                <Input
                  required
                  type="number"
                  step="any"
                  value={form.qtyDelta}
                  onChange={(e) => setForm({ ...form, qtyDelta: e.target.value })}
                  placeholder="mis. -5 atau 10"
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Alasan</label>
                <Input
                  required
                  value={form.alasan}
                  onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                  placeholder="mis. stock opname, barang rusak"
                  className="w-72"
                />
              </div>
              <Button type="submit" disabled={busy}>
                Simpan
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Material</TableHead>
                <TableHead className="text-right">Qty Delta</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : adjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Belum ada penyesuaian stok
                  </TableCell>
                </TableRow>
              ) : (
                adjustments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-4 font-medium">{a.material.nama}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${a.qtyDelta < 0 ? 'text-destructive' : 'text-green-700'}`}
                    >
                      {a.qtyDelta > 0 ? '+' : ''}
                      {a.qtyDelta.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell>{a.alasan}</TableCell>
                    <TableCell>{new Date(a.createdAt).toLocaleString('id-ID')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
