'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import type { Material } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function MaterialsClient({ canAct }: { canAct: boolean }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ nama: '', satuan: '', kategori: '' });

  const loadMaterials = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<Material[]>('/materials');
      setMaterials(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat material');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiJson('/materials', 'POST', form);
      setForm({ nama: '', satuan: '', kategori: '' });
      setShowForm(false);
      await loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah material');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canAct && (
        <div className="flex justify-end">
          <Button variant={showForm ? 'outline' : 'default'} onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" /> Tambah Material
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {canAct && showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Material Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Nama</label>
                <Input
                  required
                  value={form.nama}
                  onChange={(e) => setForm({ ...form, nama: e.target.value })}
                  placeholder="mis. Kain Katun"
                  className="w-56"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Satuan</label>
                <Input
                  required
                  value={form.satuan}
                  onChange={(e) => setForm({ ...form, satuan: e.target.value })}
                  placeholder="meter / pcs / roll"
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Kategori</label>
                <Input
                  required
                  value={form.kategori}
                  onChange={(e) => setForm({ ...form, kategori: e.target.value })}
                  placeholder="kain / benang / aksesoris"
                  className="w-48"
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
                <TableHead className="pl-4">Nama</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead>Kategori</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : materials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    Belum ada material
                  </TableCell>
                </TableRow>
              ) : (
                materials.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-4 font-medium">{m.nama}</TableCell>
                    <TableCell>{m.satuan}</TableCell>
                    <TableCell>{m.kategori}</TableCell>
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
