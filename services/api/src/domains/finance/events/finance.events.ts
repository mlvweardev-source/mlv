/**
 * Payment Events - Finance Domain
 * Published when payment status changes
 *
 * Fase 8: payload event customer-facing diperkaya dengan identitas/kontak
 * pelanggan + orderNumber (kontrak @mlv/types event-payloads) — Notification
 * berjalan di proses terpisah dan TIDAK boleh memanggil balik domain lain.
 */
import type {
  PaymentSucceededPayload,
  InvoiceIssuedPayload,
  ApprovalRequestedPayload,
  ApprovalDecidedPayload,
} from '@mlv/types';

export class PaymentSucceededEvent implements PaymentSucceededPayload {
  static eventName = 'payment.succeeded';

  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly jenis: 'DP' | 'PELUNASAN',
    public readonly jumlah: number,
    public readonly customerId: string,
    public readonly orderNumber: string,
    public readonly customerNama: string,
    public readonly customerNoHp: string | null,
  ) {}
}

export class PaymentFailedEvent {
  static eventName = 'payment.failed';

  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly reason?: string,
  ) {}
}

export class PaymentExpiredEvent {
  static eventName = 'payment.expired';

  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly orderNumber?: string,
    public readonly customerId?: string,
    public readonly customerNama?: string,
    public readonly customerNoHp?: string | null,
  ) {}
}

export class InvoiceIssuedEvent implements InvoiceIssuedPayload {
  static eventName = 'invoice.issued';

  constructor(
    public readonly invoiceId: string,
    public readonly orderId: string,
    public readonly jenis: 'DP' | 'PELUNASAN',
    public readonly jumlah: number,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly customerNama: string,
    public readonly customerNoHp: string | null,
  ) {}
}

export class ApprovalRequestedEvent implements ApprovalRequestedPayload {
  static eventName = 'approval.requested';

  constructor(
    public readonly approvalId: string,
    public readonly tipe: string,
    public readonly refId: string | null,
    public readonly requestedBy: string,
    public readonly requestedByNama: string,
  ) {}
}

export class ApprovalDecidedEvent implements ApprovalDecidedPayload {
  static eventName = 'approval.decided';

  constructor(
    public readonly approvalId: string,
    public readonly tipe: string,
    public readonly status: 'APPROVED' | 'REJECTED',
    public readonly decidedBy: string,
    public readonly decidedByNama: string,
    public readonly alasan?: string,
  ) {}
}
