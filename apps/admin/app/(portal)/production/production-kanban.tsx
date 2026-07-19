'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, X, Sparkles, AlertTriangle, Clock, ArrowRight } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import {
  TASK_TYPES,
  TASK_TYPE_LABELS,
  TASK_STATUS_LABELS,
  type ProductionTask,
  type TaskStatus,
} from '@/lib/types';
import type { StaffUser } from '@/lib/types';
import { TaskStatusBadge } from '@/components/task-status-badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** AI Production Assistant result type */
interface ProductionAiInsight {
  estimasi_lead_time: string;
  bottleneck: {
    terdeteksi: boolean;
    tahap: string | null;
    alasan: string | null;
    jumlah_task_menumpuk: number | null;
  };
  saran_urutan: Array<{
    prioritas: 'TINGGI' | 'SEDANG' | 'RENDAH';
    tahap: string;
    saran: string;
    alasan: string;
  }>;
  ringkasan: string;
}

/**
 * Transisi status yang divalidasi backend (production.service.ts):
 * MENUNGGU → SEDANG_DILAKSANAKAN; DITERIMA → SEDANG_DILAKSANAKAN | SELESAI;
 * SEDANG_DILAKSANAKAN → SELESAI; SELESAI = terminal.
 */
function nextStatuses(status: TaskStatus): TaskStatus[] {
  switch (status) {
    case 'MENUNGGU':
      return ['SEDANG_DILAKSANAKAN'];
    case 'DITERIMA':
      return ['SEDANG_DILAKSANAKAN', 'SELESAI'];
    case 'SEDANG_DILAKSANAKAN':
      return ['SELESAI'];
    default:
      return [];
  }
}

export function ProductionKanban() {
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [penjahitList, setPenjahitList] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<ProductionTask | null>(null);

  // AI Production Assistant state
  const [aiInsight, setAiInsight] = useState<ProductionAiInsight | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');

  const loadTasks = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ProductionTask[]>('/production/tasks');
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat task produksi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    // Dropdown assign: hanya Tim Penjahit
    apiFetch<StaffUser[]>('/auth/users?role=TIM_PENJAHIT')
      .then(setPenjahitList)
      .catch(() => setPenjahitList([]));
  }, [loadTasks]);

  const visibleTasks = useMemo(
    () => (showDone ? tasks : tasks.filter((t) => t.status !== 'SELESAI')),
    [tasks, showDone],
  );

  // Kolom kanban = task_type sesuai urutan routing §25.1
  const columns = useMemo(
    () =>
      TASK_TYPES.map((type) => ({
        type,
        tasks: visibleTasks.filter((t) => t.taskType === type),
      })),
    [visibleTasks],
  );

  // Unique orders from tasks for AI dropdown
  const uniqueOrders = useMemo(() => {
    const orderMap = new Map<string, { id: string; orderNumber: string }>();
    for (const task of tasks) {
      if (task.orderItem?.order && !orderMap.has(task.orderItem.order.id)) {
        orderMap.set(task.orderItem.order.id, {
          id: task.orderItem.order.id,
          orderNumber: task.orderItem.order.orderNumber,
        });
      }
    }
    return Array.from(orderMap.values());
  }, [tasks]);

  // AI Production Assistant handler
  const handleAiAnalysis = useCallback(async () => {
    if (!selectedOrderId) return;
    setAiLoading(true);
    setAiError(null);
    setAiInsight(null);
    try {
      const result = await apiFetch<{ insight: ProductionAiInsight | null }>(
        '/ai-assistant/production-assistant',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: selectedOrderId }),
        },
      );
      setAiInsight(result.insight);
      if (!result.insight) {
        setAiError('AI tidak tersedia saat ini. Coba lagi nanti.');
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Gagal meminta analisis AI');
    } finally {
      setAiLoading(false);
    }
  }, [selectedOrderId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production</h1>
          <p className="text-sm text-muted-foreground">
            Kanban board task produksi — kolom per tahap, tumpukan kartu = bottleneck
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              className="h-4 w-4"
            />
            Tampilkan yang selesai
          </label>
          <Button variant="outline" size="sm" onClick={() => void loadTasks()}>
            <RefreshCw className="h-4 w-4" /> Muat Ulang
          </Button>
        </div>
      </div>

      {/* AI Production Assistant Panel */}
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1 min-w-[200px]">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="mr-1 inline h-3 w-3" />
              AI Production Assistant
            </p>
            <Select
              value={selectedOrderId}
              onChange={(e) => {
                setSelectedOrderId(e.target.value);
                setAiInsight(null);
                setAiError(null);
              }}
            >
              <option value="">Pilih order untuk dianalisis…</option>
              {uniqueOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber}
                </option>
              ))}
            </Select>
          </div>
          <Button
            onClick={() => void handleAiAnalysis()}
            disabled={!selectedOrderId || aiLoading}
            size="sm"
          >
            {aiLoading ? (
              <>
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> Menganalisis…
              </>
            ) : (
              <>
                <Sparkles className="mr-1 h-4 w-4" /> Analisis Produksi
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {aiError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{aiError}</p>
      )}

      {aiInsight && (
        <ProductionInsightPanel insight={aiInsight} onClose={() => setAiInsight(null)} />
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.type} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-sm font-semibold">{TASK_TYPE_LABELS[col.type]}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                    col.tasks.length >= 5
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-background text-muted-foreground',
                  )}
                >
                  {col.tasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {col.tasks.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    Tidak ada task
                  </p>
                ) : (
                  col.tasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setSelected(task)}
                      className="w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">
                          {task.orderItem?.order?.orderNumber ?? '—'}
                        </span>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.orderItem?.productType ?? '—'} · urutan {task.sequence}
                      </p>
                      <p className="mt-1 text-xs">
                        {task.assignedToUser?.nama ? (
                          <span className="text-foreground">👤 {task.assignedToUser.nama}</span>
                        ) : (
                          <span className="text-muted-foreground">Belum ditugaskan</span>
                        )}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <TaskDetailPanel
          task={selected}
          penjahitList={penjahitList}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            setSelected(null);
            await loadTasks();
          }}
        />
      )}
    </div>
  );
}

/** Panel detail task: info order + assign + update status. */
function TaskDetailPanel({
  task,
  penjahitList,
  onClose,
  onChanged,
}: {
  task: ProductionTask;
  penjahitList: StaffUser[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transitions = nextStatuses(task.status);

  async function handleAssign() {
    if (!assignee) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/production/tasks/${task.id}/assign`, 'POST', { userId: assignee });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menugaskan task');
      setBusy(false);
    }
  }

  async function handleStatus(status: TaskStatus) {
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/production/tasks/${task.id}/status`, 'PATCH', { status });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal update status');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                {TASK_TYPE_LABELS[task.taskType]} · urutan {task.sequence}
              </h2>
              <p className="text-sm text-muted-foreground">
                Order{' '}
                {task.orderItem?.order ? (
                  <Link
                    href={`/orders/${task.orderItem.order.id}`}
                    className="text-primary hover:underline"
                  >
                    {task.orderItem.order.orderNumber}
                  </Link>
                ) : (
                  '—'
                )}{' '}
                · {task.orderItem?.productType ?? '—'}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-1 text-sm">
            <p>
              Status: <TaskStatusBadge status={task.status} />
            </p>
            <p>
              Ditugaskan ke:{' '}
              {task.assignedToUser?.nama ?? (
                <span className="text-muted-foreground">belum ada</span>
              )}
            </p>
            {task.startedAt && (
              <p className="text-muted-foreground">
                Mulai: {new Date(task.startedAt).toLocaleString('id-ID')}
              </p>
            )}
            {task.completedAt && (
              <p className="text-muted-foreground">
                Selesai: {new Date(task.completedAt).toLocaleString('id-ID')}
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {task.status !== 'SELESAI' && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <Select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Tugaskan ke Tim Penjahit…</option>
                  {penjahitList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nama}
                    </option>
                  ))}
                </Select>
                <Button onClick={handleAssign} disabled={!assignee || busy}>
                  Tugaskan
                </Button>
              </div>

              {transitions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {transitions.map((s) => (
                    <Button
                      key={s}
                      variant={s === 'SELESAI' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => void handleStatus(s)}
                      disabled={busy}
                    >
                      → {TASK_STATUS_LABELS[s]}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Panel insight AI produksi: bottleneck, saran urutan, estimasi lead time. */
function ProductionInsightPanel({
  insight,
  onClose,
}: {
  insight: ProductionAiInsight;
  onClose: () => void;
}) {
  const priorityColors: Record<string, string> = {
    TINGGI: 'bg-destructive/15 text-destructive',
    SEDANG: 'bg-yellow-100 text-yellow-800',
    RENDAH: 'bg-muted text-muted-foreground',
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Insight Produksi AI</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">{insight.ringkasan}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Lead Time */}
          <div className="rounded-md border bg-background p-3">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3 w-3" /> Estimasi Lead Time
            </div>
            <p className="text-lg font-semibold">{insight.estimasi_lead_time}</p>
          </div>

          {/* Bottleneck */}
          <div className="rounded-md border bg-background p-3">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <AlertTriangle className="h-3 w-3" /> Bottleneck
            </div>
            {insight.bottleneck.terdeteksi ? (
              <div>
                <p className="text-sm font-semibold text-destructive">
                  {insight.bottleneck.tahap} — {insight.bottleneck.jumlah_task_menumpuk} task
                  menumpuk
                </p>
                <p className="text-xs text-muted-foreground">{insight.bottleneck.alasan}</p>
              </div>
            ) : (
              <p className="text-sm text-green-600">Tidak terdeteksi</p>
            )}
          </div>
        </div>

        {/* Saran Urutan */}
        {insight.saran_urutan.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Saran Prioritas:</p>
            <div className="space-y-2">
              {insight.saran_urutan.map((saran, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border bg-background p-3">
                  <Badge className={cn('shrink-0', priorityColors[saran.prioritas] ?? '')}>
                    {saran.prioritas}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {saran.tahap} <ArrowRight className="mx-1 inline h-3 w-3" /> {saran.saran}
                    </p>
                    <p className="text-xs text-muted-foreground">{saran.alasan}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] italic text-muted-foreground">
          Ini adalah saran AI — staf yang memutuskan tindak lanjut. Tidak ada perubahan otomatis.
        </p>
      </CardContent>
    </Card>
  );
}
