import { Badge } from '@/components/ui/badge';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/types';

const VARIANTS: Record<TaskStatus, 'secondary' | 'warning' | 'info' | 'success'> = {
  MENUNGGU: 'secondary',
  DITERIMA: 'warning',
  SEDANG_DILAKSANAKAN: 'info',
  SELESAI: 'success',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={VARIANTS[status] ?? 'secondary'}>{TASK_STATUS_LABELS[status]}</Badge>;
}
