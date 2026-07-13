// ==========================================
// Customer Domain Events (§4 — DDD kontrak event)
// ==========================================

export class CustomerRegisteredEvent {
  static readonly eventName = 'customer.registered';

  constructor(
    public readonly customerId: string,
    public readonly nama: string,
    public readonly noHp: string | null,
    public readonly email: string | null,
    public readonly registeredAt: Date,
  ) {}
}

export class CustomerProfileUpdatedEvent {
  static readonly eventName = 'customer.profile.updated';

  constructor(
    public readonly customerId: string,
    public readonly updatedFields: string[],
    public readonly updatedAt: Date,
  ) {}
}
