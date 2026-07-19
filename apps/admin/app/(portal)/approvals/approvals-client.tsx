'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, RefreshCw, X } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_TYPE_LABELS,
  type ApprovalRow,
  type ApprovalStatus,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATUS_BADGE: Record<ApprovalStatus, 'warning' | 'success' | 'destructive'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

/**
 * Inbox approval. Owner: semua request + tombol Approve/Reject + kolom
 * catatan keputusan. Manajer: hanya request miliknya (backend filter),
 * tanpa aksi. Ajukan approval dari halaman detail Order.
 */
export function ApprovalsClient({ canDecide }: { canDecide: boolean }) {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [filter, setFilter] = useState<'' | 'PENDING' | 'DECIDED'>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const loadApprovals = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ApprovalRow[]>('/approvals');
      setApprovals(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat approval');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  async function handleDecide(id: string, status: 'APPROVED' | 'REJECTED') {
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/approvals/${id}/decide`, 'PATCH', {
        status,
        alasan: notes[id] || undefined,
      });
      setNotes((n) => ({ ...n, [id]: '' }));
      await loadApprovals();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memutuskan approval');
    } finally {
      setBusyId(null);
    }
  }

  const visible = approvals.filter((a) => {
    if (filter === 'PENDING') return a.status === 'PENDING';
    if (filter === 'DECIDED') return a.status !== 'PENDING';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approval</h1>
          <p className="text-sm text-muted-foreground">
            {canDecide
              ? 'Inbox approval — putuskan request dari Manajer Produksi'
              : 'Status request approval yang Anda ajukan'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value as '' | 'PENDING' | 'DECIDED')}
            className="w-44"
          >
            <option value="">Semua</option>
            <option value="PENDING">Menunggu keputusan</option>
            <option value="DECIDED">Sudah diputuskan</option>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void loadApprovals()}>
            <RefreshCw className="h-4 w-4" /> Muat Ulang
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tipe</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Pengaju</TableHead>
                <TableHead>Catatan Pengajuan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Keputusan</TableHead>
                {canDecide && <TableHead>Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={canDecide ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canDecide ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Tidak ada request approval
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-4 font-medium">
                      {APPROVAL_TYPE_LABELS[a.tipe]}
                    </TableCell>
                    <TableCell>
                      {a.order ? (
                        <Link
                          href={`/orders/${a.order.id}`}
                          className="text-primary hover:underline"
                        >
                          {a.order.orderNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{a.requesterNama ?? '—'}</TableCell>
                    <TableCell className="max-w-48 truncate" title={a.alasan ?? undefined}>
                      {a.alasan ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[a.status]}>
                        {APPROVAL_STATUS_LABELS[a.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.status === 'PENDING'
                        ? '—'
                        : `${a.approverNama ?? 'Owner'} · ${
                            a.decidedAt ? new Date(a.decidedAt).toLocaleString('id-ID') : ''
                          }`}
                    </TableCell>
                    {canDecide && (
                      <TableCell>
                        {a.status === 'PENDING' ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={notes[a.id] ?? ''}
                              onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                              placeholder={
                                a.tipe === 'DISKON' ? 'mis. Rp 50000 / 10%' : 'Catatan keputusan'
                              }
                              className="w-40"
                              disabled={busyId === a.id}
                            />
                            <Button
                              size="sm"
                              onClick={() => void handleDecide(a.id, 'APPROVED')}
                              disabled={busyId === a.id}
                              data-testid="approve-btn"
                            >
                              <Check className="h-3 w-3" /> Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void handleDecide(a.id, 'REJECTED')}
                              disabled={busyId === a.id}
                              data-testid="reject-btn"
                            >
                              <X className="h-3 w-3" /> Reject
                            </Button>
                          </div>
                        ) : (
                          '—'
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
