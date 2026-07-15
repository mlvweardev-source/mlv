import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Dashboard stub (Fase 9 Bagian 1) — metrik sungguhan diisi Fase 13.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Analytics</h1>
        <p className="text-sm text-muted-foreground">Metrik analytics akan tersedia di Fase 13.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {['Total Order', 'Dalam Produksi', 'Pendapatan Bulan Ini'].map((title) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <CardDescription>Coming Soon — Fase 13</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-muted-foreground/40">—</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
