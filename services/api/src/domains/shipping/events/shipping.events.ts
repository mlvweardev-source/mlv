// ==========================================
// Shipping Domain Events (§4 — DDD kontrak event)
//
// Fase 8: payload diperkaya kontak pelanggan + noResi (kontrak
// @mlv/types event-payloads) — Notification proses terpisah tidak
// boleh memanggil balik domain lain untuk melengkapi data.
// ==========================================
import type { ShipmentCreatedPayload } from '@mlv/types';

export class ShipmentCreatedEvent implements ShipmentCreatedPayload {
  static readonly eventName = 'shipment.created';

  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly kurir: string,
    public readonly trackingToken: string,
    public readonly createdAt: Date,
    public readonly noResi: string | null,
    public readonly customerId: string,
    public readonly customerNama: string,
    public readonly customerNoHp: string | null,
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
