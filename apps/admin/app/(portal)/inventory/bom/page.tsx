'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { BomRow } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * BOM per product type — read-only view (data master dari Fase 2).
 * Edit BOM = keputusan produksi, belum masuk scope UI bagian ini.
 */
export default function BomPage() {
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BomRow[]>('/bom')
      .then(setBoms)
      .catch((e) => setError(e instanceof Error ? e.message : 'Gagal memuat BOM'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, BomRow[]>();
    for (const bom of boms) {
      const list = map.get(bom.productType) ?? [];
      list.push(bom);
      map.set(bom.productType, list);
    }
    return [...map.entries()];
  }, [boms]);

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Belum ada BOM
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grouped.map(([productType, rows]) => (
            <Card key={productType}>
              <CardHeader>
                <CardTitle>{productType}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Material</TableHead>
                      <TableHead className="text-right">Qty per Unit</TableHead>
                      <TableHead className="pr-6">Satuan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="pl-6">{row.material.nama}</TableCell>
                        <TableCell className="text-right">{row.qtyPerUnit}</TableCell>
                        <TableCell className="pr-6">{row.material.satuan}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
