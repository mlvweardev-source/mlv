'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import type { ProfitSharingRow } from '@/lib/types';
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

interface FormState {
  pihak: string;
  persentase: string;
  nominal: string;
  periode: string;
  catatan: string;
}

const EMPTY_FORM: FormState = { pihak: '', persentase: '', nominal: '', periode: '', catatan: '' };

/** CRUD bagi hasil — Owner-only (§5.1). */
export function ProfitSharingClient() {
  const [rows, setRows] = useState<ProfitSharingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const loadRows = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ProfitSharingRow[]>('/profit-sharing');
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat bagi hasil');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function startEdit(row: ProfitSharingRow) {
    setEditingId(row.id);
    setForm({
      pihak: row.pihak,
      persentase: String(row.persentase),
      nominal: row.nominal != null ? String(row.nominal) : '',
      periode: row.periode ?? '',
      catatan: row.catatan ?? '',
    });
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const persentase = Number(form.persentase);
    if (Number.isNaN(persentase) || persentase < 0 || persentase > 100) {
      setError('Persentase harus 0–100');
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      pihak: form.pihak,
      persentase,
      nominal: form.nominal ? Number(form.nominal) : undefined,
      catatan: form.catatan || undefined,
      // periode hanya dikirim saat create (Update DTO tidak menerima periode)
      ...(editingId ? {} : { periode: form.periode || undefined }),
    };
    try {
      if (editingId) {
        await apiJson(`/profit-sharing/${editingId}`, 'PATCH', body);
      } else {
        await apiJson('/profit-sharing', 'POST', body);
      }
      resetForm();
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan bagi hasil');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Hapus entri bagi hasil ini?')) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/profit-sharing/${id}`, 'DELETE');
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus bagi hasil');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant={showForm ? 'outline' : 'default'}
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          disabled={busy}
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Batal' : 'Tambah Bagi Hasil'}
        </Button>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Bagi Hasil' : 'Bagi Hasil Baru'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Pihak</label>
                <Input
                  required
                  value={form.pihak}
                  onChange={(e) => setForm({ ...form, pihak: e.target.value })}
                  placeholder="owner / manajer / penjahit"
                  className="w-48"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Persentase (%)</label>
                <Input
                  required
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  value={form.persentase}
                  onChange={(e) => setForm({ ...form, persentase: e.target.value })}
                  className="w-32"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Nominal (Rp, opsional)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.nominal}
                  onChange={(e) => setForm({ ...form, nominal: e.target.value })}
                  className="w-40"
                  disabled={busy}
                />
              </div>
              {!editingId && (
                <div className="space-y-1">
                  <label className="text-sm font-medium">Periode (YYYY-MM, opsional)</label>
                  <Input
                    value={form.periode}
                    onChange={(e) => setForm({ ...form, periode: e.target.value })}
                    placeholder="2026-07"
                    className="w-36"
                    disabled={busy}
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">Catatan (opsional)</label>
                <Input
                  value={form.catatan}
                  onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                  className="w-56"
                  disabled={busy}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {editingId ? 'Simpan Perubahan' : 'Simpan'}
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
                <TableHead className="pl-4">Pihak</TableHead>
                <TableHead className="text-right">Persentase</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Belum ada pengaturan bagi hasil
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 font-medium">{row.pihak}</TableCell>
                    <TableCell className="text-right">{row.persentase}%</TableCell>
                    <TableCell className="text-right">
                      {row.nominal != null ? `Rp ${row.nominal.toLocaleString('id-ID')}` : '—'}
                    </TableCell>
                    <TableCell>{row.periode ?? '—'}</TableCell>
                    <TableCell>{row.catatan ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(row)}
                          disabled={busy}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void handleDelete(row.id)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3 w-3" /> Hapus
                        </Button>
                      </div>
                    </TableCell>
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
