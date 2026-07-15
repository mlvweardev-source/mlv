import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@/lib/types';

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; variant: 'secondary' | 'warning' | 'info' | 'success' | 'destructive' }
> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  MENUNGGU_PEMBAYARAN_DP: { label: 'Menunggu DP', variant: 'warning' },
  ANTREAN: { label: 'Antrean', variant: 'info' },
  CUTTING: { label: 'Cutting', variant: 'info' },
  PRINTING: { label: 'Printing', variant: 'info' },
  EMBROIDERY: { label: 'Embroidery', variant: 'info' },
  SEWING: { label: 'Sewing', variant: 'info' },
  FINISHING: { label: 'Finishing', variant: 'info' },
  IRONING: { label: 'Ironing', variant: 'info' },
  PACKING: { label: 'Packing', variant: 'info' },
  SELESAI: { label: 'Selesai', variant: 'success' },
  MENUNGGU_PELUNASAN: { label: 'Menunggu Pelunasan', variant: 'warning' },
  LUNAS: { label: 'Lunas', variant: 'success' },
  DIKIRIM: { label: 'Dikirim', variant: 'success' },
  DIBATALKAN: { label: 'Dibatalkan', variant: 'destructive' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function statusLabel(status: OrderStatus): string {
  return STATUS_CONFIG[status]?.label ?? status;
}
