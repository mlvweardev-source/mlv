import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUES, EVENT_NAMES, EVENT_ROUTING } from '@mlv/types';
import { EventBusService } from './event-bus.service';

/**
 * EventBusService (Unit) — verifikasi routing event → queue konsumen (§4, §7)
 */
describe('EventBusService (Unit)', () => {
  let service: EventBusService;
  const queueMocks: Record<string, { add: jest.Mock }> = {};

  beforeEach(async () => {
    for (const name of Object.values(QUEUES)) {
      queueMocks[name] = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusService,
        ...Object.values(QUEUES).map((name) => ({
          provide: getQueueToken(name),
          useValue: queueMocks[name],
        })),
      ],
    }).compile();

    service = module.get<EventBusService>(EventBusService);
    jest.clearAllMocks();
  });

  it('should route PaymentSucceeded to order-events AND notification-events (§7.2)', async () => {
    const payload = { paymentId: 'pay-1', orderId: 'order-1', jenis: 'DP', jumlah: 100000 };

    await service.publish(EVENT_NAMES.PaymentSucceeded, payload);

    expect(queueMocks[QUEUES.ORDER_EVENTS].add).toHaveBeenCalledWith(
      EVENT_NAMES.PaymentSucceeded,
      payload,
      expect.objectContaining({ attempts: 3 }),
    );
    expect(queueMocks[QUEUES.NOTIFICATION_EVENTS].add).toHaveBeenCalledWith(
      EVENT_NAMES.PaymentSucceeded,
      payload,
      expect.objectContaining({ attempts: 3 }),
    );
    // TIDAK dirutekan ke queue lain
    expect(queueMocks[QUEUES.INVENTORY_EVENTS].add).not.toHaveBeenCalled();
    expect(queueMocks[QUEUES.PRODUCTION_EVENTS].add).not.toHaveBeenCalled();
    expect(queueMocks[QUEUES.FINANCE_EVENTS].add).not.toHaveBeenCalled();
  });

  it('should route OrderConfirmed to inventory, production, and notification queues (§7.2 cascade)', async () => {
    const payload = { orderId: 'order-1', orderNumber: 'MLV-001', customerId: 'cust-1' };

    await service.publish(EVENT_NAMES.OrderConfirmed, payload);

    expect(queueMocks[QUEUES.INVENTORY_EVENTS].add).toHaveBeenCalled();
    expect(queueMocks[QUEUES.PRODUCTION_EVENTS].add).toHaveBeenCalled();
    expect(queueMocks[QUEUES.NOTIFICATION_EVENTS].add).toHaveBeenCalled();
    expect(queueMocks[QUEUES.ORDER_EVENTS].add).not.toHaveBeenCalled();
  });

  it('should route ProductionCompleted to order, finance, and notification queues (§4)', async () => {
    const payload = { orderId: 'order-1', orderNumber: 'MLV-001' };

    await service.publish(EVENT_NAMES.ProductionCompleted, payload);

    expect(queueMocks[QUEUES.ORDER_EVENTS].add).toHaveBeenCalled();
    expect(queueMocks[QUEUES.FINANCE_EVENTS].add).toHaveBeenCalled();
    expect(queueMocks[QUEUES.NOTIFICATION_EVENTS].add).toHaveBeenCalled();
  });

  it('should route ShipmentCreated to order-events AND notification-events (§7.1 Fase 7)', async () => {
    const payload = {
      shipmentId: 'ship-1',
      orderId: 'order-1',
      orderNumber: 'MLV-001',
      kurir: 'JNE',
      trackingToken: 'token-abc',
    };

    await service.publish(EVENT_NAMES.ShipmentCreated, payload);

    // Order Domain konsumsi → transisi status → DIKIRIM (§7.1)
    expect(queueMocks[QUEUES.ORDER_EVENTS].add).toHaveBeenCalledWith(
      EVENT_NAMES.ShipmentCreated,
      payload,
      expect.objectContaining({ attempts: 3 }),
    );
    // Notification = subscriber umum
    expect(queueMocks[QUEUES.NOTIFICATION_EVENTS].add).toHaveBeenCalled();
    // TIDAK dirutekan ke queue lain
    expect(queueMocks[QUEUES.INVENTORY_EVENTS].add).not.toHaveBeenCalled();
    expect(queueMocks[QUEUES.PRODUCTION_EVENTS].add).not.toHaveBeenCalled();
    expect(queueMocks[QUEUES.FINANCE_EVENTS].add).not.toHaveBeenCalled();
  });

  it('should route ShipmentDelivered to order-events AND notification-events (§4 Fase 7)', async () => {
    await service.publish(EVENT_NAMES.ShipmentDelivered, {
      shipmentId: 'ship-1',
      orderId: 'order-1',
    });

    expect(queueMocks[QUEUES.ORDER_EVENTS].add).toHaveBeenCalled();
    expect(queueMocks[QUEUES.NOTIFICATION_EVENTS].add).toHaveBeenCalled();
  });

  it('should apply retry policy: 3 attempts with exponential backoff (DLQ = failed state)', async () => {
    await service.publish(EVENT_NAMES.StockLow, { materialId: 'mat-1' });

    expect(queueMocks[QUEUES.NOTIFICATION_EVENTS].add).toHaveBeenCalledWith(
      EVENT_NAMES.StockLow,
      expect.anything(),
      expect.objectContaining({
        attempts: 3,
        backoff: expect.objectContaining({ type: 'exponential' }),
        removeOnFail: false, // failed jobs = DLQ, jangan dihapus
      }),
    );
  });

  it('should route EVERY catalogued event to notification-events (Notification = subscriber umum §4)', () => {
    for (const targets of Object.values(EVENT_ROUTING)) {
      expect(targets).toContain(QUEUES.NOTIFICATION_EVENTS);
    }
  });
});
