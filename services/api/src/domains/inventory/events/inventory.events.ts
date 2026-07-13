// ==========================================
// Inventory Domain Events (§4 — DDD kontrak event)
// ==========================================

export class StockReservedEvent {
  static readonly eventName = 'stock.reserved';

  constructor(
    public readonly reservationId: string,
    public readonly orderId: string,
    public readonly materialId: string,
    public readonly qty: number,
    public readonly expiresAt: Date,
  ) {}
}

export class StockReservationReleasedEvent {
  static readonly eventName = 'stock.reservation.released';

  constructor(
    public readonly reservationId: string,
    public readonly orderId: string,
    public readonly materialId: string,
    public readonly qty: number,
  ) {}
}

export class StockDeductedEvent {
  static readonly eventName = 'stock.deducted';

  constructor(
    public readonly materialId: string,
    public readonly warehouseId: string,
    public readonly qty: number,
    public readonly refType: string | null,
    public readonly refId: string | null,
  ) {}
}

export class StockLowEvent {
  static readonly eventName = 'stock.low';

  constructor(
    public readonly materialId: string,
    public readonly warehouseId: string,
    public readonly qtyAvailable: number,
    public readonly limit: number,
  ) {}
}
