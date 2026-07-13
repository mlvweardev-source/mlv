// ==========================================
// Order Domain Events (§4 — DDD kontrak event)
// ==========================================

export class OrderCreatedEvent {
  static readonly eventName = 'order.created';

  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly createdAt: Date,
  ) {}
}

export class OrderConfirmedEvent {
  static readonly eventName = 'order.confirmed';

  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly confirmedAt: Date,
  ) {}
}

export class OrderCancelledEvent {
  static readonly eventName = 'order.cancelled';

  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly reason?: string,
    public readonly cancelledAt: Date = new Date(),
  ) {}
}

export class OrderStatusChangedEvent {
  static readonly eventName = 'order.status.changed';

  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly previousStatus: string,
    public readonly newStatus: string,
    public readonly changedAt: Date,
  ) {}
}
