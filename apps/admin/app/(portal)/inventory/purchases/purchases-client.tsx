'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import type { Material, PurchaseOrderRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function PurchasesClient({ canAct }: { canAct: boolean }) {
  const [purchases, setPurchases] = useState<PurchaseOrderRow[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    supplier: '',
    materialId: '',
    qty: '',
    totalBiaya: '',
    tglBeli: '',
  });

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [purchaseData, materialData] = await Promise.all([
        apiFetch<PurchaseOrderRow[]>('/purchases'),
        apiFetch<Material[]>('/materials'),
      ]);
      setPurchases(purchaseData);
      setMaterials(materialData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat purchase order');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiJson('/purchases', 'POST', {
        supplier: form.supplier,
        materialId: form.materialId,
        qty: Number(form.qty),
        totalBiaya: Number(form.totalBiaya),
        tglBeli: form.tglBeli,
      });
      setForm({ supplier: '', materialId: '', qty: '', totalBiaya: '', tglBeli: '' });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat purchase order');
    } finally {
      setBusy(false);
    }
  }

  /** Tandai diterima: backend mencatat movement IN + menambah stock balance. */
  async function handleComplete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/purchases/${id}/complete`, 'PATCH');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menandai PO diterima');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {canAct && (
        <div className="flex justify-end">
          <Button variant={showForm ? 'outline' : 'default'} onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" /> Buat Purchase Order
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {canAct && showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase Order Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Supplier</label>
                <Input
                  required
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  placeholder="mis. Toko Kain Jaya"
                  className="w-56"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Material</label>
                <Select
                  required
                  value={form.materialId}
                  onChange={(e) => setForm({ ...form, materialId: e.target.value })}
                  className="w-52"
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
                <label className="text-sm font-medium">Qty</label>
                <Input
                  required
                  type="number"
                  step="any"
                  min="0.001"
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  className="w-28"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Total Biaya (Rp)</label>
                <Input
                  required
                  type="number"
                  min="0"
                  value={form.totalBiaya}
                  onChange={(e) => setForm({ ...form, totalBiaya: e.target.value })}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Tgl Beli</label>
                <Input
                  required
                  type="date"
                  value={form.tglBeli}
                  onChange={(e) => setForm({ ...form, tglBeli: e.target.value })}
                  className="w-40"
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
                <TableHead className="pl-4">Supplier</TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total Biaya</TableHead>
                <TableHead>Tgl Beli</TableHead>
                <TableHead>Status</TableHead>
                {canAct && <TableHead>Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={canAct ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : purchases.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canAct ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Belum ada purchase order
                  </TableCell>
                </TableRow>
              ) : (
                purchases.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="pl-4 font-medium">{po.supplier}</TableCell>
                    <TableCell>
                      {po.material.nama} ({po.material.satuan})
                    </TableCell>
                    <TableCell className="text-right">{po.qty.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right">
                      Rp {po.totalBiaya.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell>{new Date(po.tglBeli).toLocaleDateString('id-ID')}</TableCell>
                    <TableCell>
                      {po.status === 'COMPLETED' ? (
                        <Badge variant="success">Diterima</Badge>
                      ) : (
                        <Badge variant="warning">Pending</Badge>
                      )}
                    </TableCell>
                    {canAct && (
                      <TableCell>
                        {po.status === 'PENDING' && (
                          <Button
                            size="sm"
                            onClick={() => void handleComplete(po.id)}
                            disabled={busyId === po.id}
                          >
                            <Check className="h-4 w-4" /> Tandai Diterima
                          </Button>
                        )}
                      </TableCell>
                    )}
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
