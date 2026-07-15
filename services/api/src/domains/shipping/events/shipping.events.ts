// ==========================================
// Shipping Domain Events (§4 — DDD kontrak event)
// ==========================================

export class ShipmentCreatedEvent {
  static readonly eventName = 'shipment.created';

  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly kurir: string,
    public readonly trackingToken: string,
    public readonly createdAt: Date,
  ) {}
}

export class ShipmentDeliveredEvent {
  static readonly eventName = 'shipment.delivered';

  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly deliveredAt: Date,
  ) {}
}
