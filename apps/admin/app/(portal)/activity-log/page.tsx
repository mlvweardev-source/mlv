'use client';

import { useEffect, useState } from 'react';
import { History, Clock } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ActivityEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  deskripsi: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-800',
  MANAJER_PRODUKSI: 'bg-blue-100 text-blue-800',
  TIM_PENJAHIT: 'bg-green-100 text-green-800',
  SYSTEM: 'bg-gray-100 text-gray-600',
};

const ENTITY_LABELS: Record<string, string> = {
  Order: 'Order',
  ProductionTask: 'Task Produksi',
  Approval: 'Approval',
  Shipment: 'Pengiriman',
};

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ActivityEntry[]>('/activity-log');
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat riwayat aktivitas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Riwayat Aktivitas</h1>
        <p className="text-sm text-muted-foreground">
          Log aktivitas sistem-wide — {entries.length} entri terbaru
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <History className="mx-auto mb-2 h-8 w-8 opacity-30" />
            Belum ada aktivitas tercatat
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <Card key={entry.id} className="text-sm">
              <CardContent className="flex items-start gap-3 py-3">
                <div className="mt-0.5 shrink-0">
                  <History className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {ENTITY_LABELS[entry.entityType] ?? entry.entityType}
                    </span>
                    {entry.actorRole && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          ROLE_COLORS[entry.actorRole] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {entry.actorRole}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(entry.createdAt).toLocaleString('id-ID')}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed">{entry.deskripsi}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
