'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { apiFetch, apiJson } from '@/lib/api';
import {
  TASK_TYPE_LABELS,
  TASK_STATUS_LABELS,
  type ProductionTask,
  type TaskStatus,
} from '@/lib/types';
import { TaskStatusBadge } from '@/components/task-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * View Tim Penjahit: tabel flat task MILIKNYA sendiri.
 * Backend sudah memfilter otomatis (GET /production/tasks → assignedTo = JWT sub
 * untuk role TIM_PENJAHIT) — tidak perlu kirim query param apa pun.
 * Update status per baris; backend menolak task milik orang lain (Fase 4).
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

export function MyTasksTable() {
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<ProductionTask[]>('/production/tasks');
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat task');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function handleStatus(taskId: string, status: TaskStatus) {
    setBusyId(taskId);
    setError(null);
    try {
      await apiJson(`/production/tasks/${taskId}/status`, 'PATCH', { status });
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal update status');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Saya</h1>
          <p className="text-sm text-muted-foreground">
            Daftar task produksi yang ditugaskan kepada Anda
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadTasks()}>
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
                <TableHead>Produk</TableHead>
                <TableHead>Tahap</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Memuat…
                  </TableCell>
                </TableRow>
              ) : tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Belum ada task yang ditugaskan kepada Anda
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="pl-4 font-medium">
                      {task.orderItem?.order ? (
                        <Link
                          href={`/orders/${task.orderItem.order.id}`}
                          className="text-primary hover:underline"
                        >
                          {task.orderItem.order.orderNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{task.orderItem?.productType ?? '—'}</TableCell>
                    <TableCell>
                      {TASK_TYPE_LABELS[task.taskType]}{' '}
                      <span className="text-xs text-muted-foreground">
                        (urutan {task.sequence})
                      </span>
                    </TableCell>
                    <TableCell>
                      <TaskStatusBadge status={task.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {nextStatuses(task.status).map((s) => (
                          <Button
                            key={s}
                            variant={s === 'SELESAI' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => void handleStatus(task.id, s)}
                            disabled={busyId === task.id}
                          >
                            → {TASK_STATUS_LABELS[s]}
                          </Button>
                        ))}
                      </div>
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
