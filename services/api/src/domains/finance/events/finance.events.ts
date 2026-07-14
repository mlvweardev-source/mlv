/**
 * Payment Events - Finance Domain
 * Published when payment status changes
 */

export class PaymentSucceededEvent {
  static eventName = 'payment.succeeded';

  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly jenis: 'DP' | 'PELUNASAN',
    public readonly jumlah: number,
    public readonly customerId: string,
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
  ) {}
}

export class InvoiceIssuedEvent {
  static eventName = 'invoice.issued';

  constructor(
    public readonly invoiceId: string,
    public readonly orderId: string,
    public readonly jenis: 'DP' | 'PELUNASAN',
    public readonly jumlah: number,
  ) {}
}

export class ApprovalRequestedEvent {
  static eventName = 'approval.requested';

  constructor(
    public readonly approvalId: string,
    public readonly tipe: string,
    public readonly refId: string | null,
    public readonly requestedBy: string,
  ) {}
}

export class ApprovalDecidedEvent {
  static eventName = 'approval.decided';

  constructor(
    public readonly approvalId: string,
    public readonly tipe: string,
    public readonly status: 'APPROVED' | 'REJECTED',
    public readonly decidedBy: string,
    public readonly alasan?: string,
  ) {}
}
