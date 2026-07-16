'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { StockBalanceRow } from '@/lib/types';
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

/** Batas stok menipis — sama dengan LIMIT StockLow di backend. */
const LOW_STOCK_LIMIT = 5;

export default function StockPage() {
  const [balances, setBalances] = useState<StockBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<StockBalanceRow[]>('/stock/balance')
      .then(setBalances)
      .catch((e) => setError(e instanceof Error ? e.message : 'Gagal memuat stok'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Material</TableHead>
                <TableHead>Gudang</TableHead>
                <TableHead className="text-right">Tersedia</TableHead>
                <TableHead className="text-right">Direservasi</TableHead>
                <TableHead className="text-right">Bebas Dipakai</TableHead>
                <TableHead>Satuan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : balances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Belum ada data stok
                  </TableCell>
                </TableRow>
              ) : (
                balances.map((b) => {
                  const free = b.qtyAvailable - b.qtyReserved;
                  return (
                    <TableRow key={`${b.materialId}-${b.warehouseId}`}>
                      <TableCell className="pl-4 font-medium">
                        {b.material.nama}
                        {b.qtyAvailable < LOW_STOCK_LIMIT && (
                          <Badge variant="destructive" className="ml-2">
                            Menipis
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{b.warehouse.nama}</TableCell>
                      <TableCell className="text-right">
                        {b.qtyAvailable.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.qtyReserved.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {free.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell>{b.material.satuan}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
