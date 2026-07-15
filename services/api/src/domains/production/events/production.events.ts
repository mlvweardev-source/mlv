// ==========================================
// Production Domain Events (§7.1)
//
// Fase 8: ProductionCompleted diperkaya kontak pelanggan (kontrak
// @mlv/types event-payloads) untuk WA "produksi selesai, menunggu
// pelunasan" — Notification proses terpisah tidak boleh memanggil
// balik domain lain.
// ==========================================
import type { ProductionCompletedPayload } from '@mlv/types';

export class TaskStartedEvent {
  static readonly eventName = 'production.task.started';

  constructor(
    public readonly taskId: string,
    public readonly orderItemId: string,
    public readonly taskType: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly startedAt: Date,
  ) {}
}

export class TaskCompletedEvent {
  static readonly eventName = 'production.task.completed';

  constructor(
    public readonly taskId: string,
    public readonly orderItemId: string,
    public readonly taskType: string,
    public readonly sequence: number,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly completedAt: Date,
  ) {}
}

export class ProductionCompletedEvent implements ProductionCompletedPayload {
  static readonly eventName = 'production.completed';

  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly completedAt: Date,
    public readonly customerNama: string,
    public readonly customerNoHp: string | null,
  ) {}
}
