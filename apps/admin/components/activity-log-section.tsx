'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface ActivityEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  deskripsi: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  MANAJER_PRODUKSI: 'Manajer',
  TIM_PENJAHIT: 'Penjahit',
  SYSTEM: 'Sistem',
};

/**
 * Section "Riwayat Aktivitas" di halaman detail order.
 * Memakai filter entityType=Order + entityId=orderId.
 * Terpisah dari Timeline (order_timeline_events) — boleh berdampingan.
 */
export function ActivityLogSection({ orderId }: { orderId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ActivityEntry[]>(`/activity-log?entityType=Order&entityId=${orderId}&limit=20`)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Memuat riwayat…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Belum ada aktivitas tercatat.</p>;
  }

  return (
    <ol className="relative space-y-3 border-l pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-secondary ring-2 ring-background" />
          <p className="text-xs leading-relaxed">{entry.deskripsi}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {entry.actorRole && (
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">
                {ROLE_LABELS[entry.actorRole] ?? entry.actorRole}
              </span>
            )}
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {new Date(entry.createdAt).toLocaleString('id-ID')}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
