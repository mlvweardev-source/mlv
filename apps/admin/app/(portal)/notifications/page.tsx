'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

interface Notification {
  id: string;
  eventType: string | null;
  channel: string;
  pesan: string;
  statusKirim: string;
  errorMsg: string | null;
  createdAt: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WA',
  EMAIL: 'Email',
  DASHBOARD: 'Dashboard',
  PUSH: 'Push',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterChannel) params.set('channel', filterChannel);
      if (filterStatus) params.set('status', filterStatus);
      const query = params.toString() ? `?${params.toString()}` : '';
      // Fetch SAME-ORIGIN ke /api/notifications (route handler Next.js) —
      // server yang meneruskan ke services/notification (port 3001).
      // Browser tidak pernah bicara lintas origin, cookie httpOnly pasti ikut.
      const res = await fetch(`/api/notifications${query}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat notifikasi');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filterChannel, filterStatus]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifikasi</h1>
          <p className="text-sm text-muted-foreground">
            Riwayat dispatch — {notifications.length} hasil terbaru
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="w-36"
        >
          <option value="">Semua Channel</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">Email</option>
          <option value="DASHBOARD">Dashboard</option>
          <option value="PUSH">Push</option>
        </Select>
        <Select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-36"
        >
          <option value="">Semua Status</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="PENDING">Pending</option>
        </Select>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
            Tidak ada notifikasi
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card key={n.id} className="text-sm">
              <CardContent className="flex items-start gap-3 py-3">
                <div className="mt-0.5 shrink-0">
                  {n.statusKirim === 'SENT' && (
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                  )}
                  {n.statusKirim === 'FAILED' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                  {n.statusKirim === 'PENDING' && <Clock className="h-3.5 w-3.5 text-yellow-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {CHANNEL_LABELS[n.channel] ?? n.channel}
                    </span>
                    {n.eventType && (
                      <span className="text-xs text-muted-foreground">{n.eventType}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString('id-ID')}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed">{n.pesan}</p>
                  {n.errorMsg && <p className="mt-1 text-xs text-red-500">Error: {n.errorMsg}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
