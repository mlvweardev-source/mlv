'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, RefreshCw } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import { SHIPMENT_STATUS_LABELS, type ShipmentRow, type ShipmentStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const STATUS_BADGE: Record<ShipmentStatus, 'secondary' | 'info' | 'warning' | 'success'> = {
  DICATAT: 'secondary',
  DIKIRIM: 'info',
  DALAM_TRANSIT: 'warning',
  DITERIMA: 'success',
};

/** Transisi status shipment yang masuk akal maju (backend menerima bebas). */
const NEXT_STATUS: Record<ShipmentStatus, ShipmentStatus[]> = {
  DICATAT: ['DIKIRIM'],
  DIKIRIM: ['DALAM_TRANSIT', 'DITERIMA'],
  DALAM_TRANSIT: ['DITERIMA'],
  DITERIMA: [],
};

/**
 * Daftar shipment (Fase 9.3) — Owner & Manajer full (§5.1).
 * Buat shipment dari halaman detail Order (gate LUNAS); di sini:
 * lihat semua, update status, salin token tracking publik.
 */
export default function ShippingPage() {
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadShipments = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ShipmentRow[]>('/shipments');
      setShipments(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat shipment');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShipments();
  }, [loadShipments]);

  async function handleStatusChange(id: string, status: ShipmentStatus) {
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/shipments/${id}`, 'PATCH', { status });
      await loadShipments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal update status shipment');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopyToken(id: string, token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard tidak tersedia
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shipping</h1>
          <p className="text-sm text-muted-foreground">
            Daftar pengiriman — buat shipment baru dari halaman detail Order (order harus Lunas)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadShipments()}>
          <RefreshCw className="h-4 w-4" /> Muat Ulang
        </Button>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Order</TableHead>
                <TableHead>Kurir</TableHead>
                <TableHead>No. Resi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dikirim</TableHead>
                <TableHead>Token Tracking</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : shipments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Belum ada shipment
                  </TableCell>
                </TableRow>
              ) : (
                shipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/orders/${s.orderId}`} className="text-primary hover:underline">
                        Lihat order
                      </Link>
                    </TableCell>
                    <TableCell>{s.kurir}</TableCell>
                    <TableCell>{s.noResi ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[s.status]}>
                        {SHIPMENT_STATUS_LABELS[s.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.shippedAt ? new Date(s.shippedAt).toLocaleDateString('id-ID') : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyToken(s.id, s.trackingToken)}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedId === s.id ? 'Tersalin!' : 'Salin Token'}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {NEXT_STATUS[s.status].length > 0 ? (
                        <Select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              void handleStatusChange(s.id, e.target.value as ShipmentStatus);
                            }
                          }}
                          className="w-40"
                          disabled={busyId === s.id}
                        >
                          <option value="">Ubah status…</option>
                          {NEXT_STATUS[s.status].map((next) => (
                            <option key={next} value={next}>
                              → {SHIPMENT_STATUS_LABELS[next]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        '—'
                      )}
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
