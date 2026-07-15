import { Test, TestingModule } from '@nestjs/testing';
import { ProductionService } from './services/production.service';
import { OrderService } from '../order/services/order.service';
import { CustomerService } from '../customer/services/customer.service';
import { EventBusService } from '../../event-bus/event-bus.service';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    productionRouting: {
      findUnique: jest.fn(),
    },
    productionTask: {
      create: jest.fn(),
      count: jest.fn(),
    },
    orderItem: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '@mlv/db';

/**
 * Idempotency tests untuk consumer OrderConfirmed di Production Domain (§16).
 *
 * Event OrderConfirmed yang dikirim dua kali TIDAK boleh menghasilkan
 * production tasks ganda — cek state DB (count tasks per order item),
 * bukan mengandalkan dedup BullMQ.
 */
describe('ProductionService - OrderConfirmed Consumer Idempotency (§16)', () => {
  let service: ProductionService;

  const orderItem = {
    id: 'item-1',
    productType: 'KAOS',
    services: [],
  };

  const routing = {
    id: 'routing-1',
    productType: 'KAOS',
    urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        {
          provide: EventBusService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: OrderService,
          useValue: { addTimelineEvent: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CustomerService,
          useValue: { getCustomerByIdInternal: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
  });

  it('should generate tasks on first OrderConfirmed delivery', async () => {
    (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([orderItem]);
    (prisma.productionTask.count as jest.Mock).mockResolvedValue(0); // belum ada task
    (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue(routing);
    (prisma.productionTask.create as jest.Mock).mockResolvedValue({ id: 'task-1' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

    await service.handleOrderConfirmed('order-1', 'MLV-001', 'customer-1');

    expect(prisma.productionTask.create).toHaveBeenCalledTimes(routing.urutanTask.length);
  });

  it('should be a NO-OP on duplicate OrderConfirmed delivery (tasks already exist)', async () => {
    (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([orderItem]);
    (prisma.productionTask.count as jest.Mock).mockResolvedValue(5); // task sudah ada dari delivery pertama

    await service.handleOrderConfirmed('order-1', 'MLV-001', 'customer-1');

    // TIDAK ada task ganda
    expect(prisma.productionTask.create).not.toHaveBeenCalled();
    expect(prisma.productionRouting.findUnique).not.toHaveBeenCalled();
  });

  it('should create tasks EXACTLY ONCE when the same event is delivered twice', async () => {
    (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([orderItem]);
    // Delivery 1: belum ada task → generate
    (prisma.productionTask.count as jest.Mock).mockResolvedValueOnce(0);
    // Delivery 2: task sudah ada → skip
    (prisma.productionTask.count as jest.Mock).mockResolvedValueOnce(5);
    (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue(routing);
    (prisma.productionTask.create as jest.Mock).mockResolvedValue({ id: 'task-1' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

    await service.handleOrderConfirmed('order-1', 'MLV-001', 'customer-1');
    await service.handleOrderConfirmed('order-1', 'MLV-001', 'customer-1'); // duplikat

    // Task dibuat TEPAT SATU RONDE (5 task untuk 1 item, bukan 10)
    expect(prisma.productionTask.create).toHaveBeenCalledTimes(routing.urutanTask.length);
  });
});
