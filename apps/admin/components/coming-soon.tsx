import { Card, CardContent } from '@/components/ui/card';

/**
 * Placeholder modul yang belum dibangun (Fase 9 Bagian 2-5).
 */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16">
          <p className="text-lg font-medium text-muted-foreground">Coming Soon</p>
          <p className="text-sm text-muted-foreground">
            Modul ini akan dibangun di bagian berikutnya Fase 9.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
