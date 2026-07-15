import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FinanceService } from './services/finance.service';
import { OrderService } from '../order/services/order.service';
import { InventoryService } from '../inventory/services/inventory.service';
import { CustomerService } from '../customer/services/customer.service';
import { AuthService } from '../identity-access/services/auth.service';
import { EventBusService } from '../../event-bus/event-bus.service';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '@mlv/db';

/**
 * Idempotency tests untuk consumer ProductionCompleted di Finance Domain (§16).
 *
 * Event yang dikirim dua kali TIDAK boleh menghasilkan invoice
 * Pelunasan ganda — cek invoice yang sudah ada di DB dulu.
 */
describe('FinanceService - ProductionCompleted Consumer Idempotency (§16)', () => {
  let service: FinanceService;

  const order = {
    id: 'order-1',
    orderNumber: 'MLV-001',
    items: [
      {
        basePriceSnapshot: 100000,
        sizes: [{ qty: 10 }],
        services: [],
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: EventBusService, useValue: { publish: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: OrderService, useValue: {} },
        { provide: InventoryService, useValue: {} },
        {
          provide: CustomerService,
          useValue: { getCustomerByIdInternal: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: AuthService,
          useValue: { getUserByIdInternal: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  it('should create Pelunasan invoice on first delivery', async () => {
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null); // belum ada invoice
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ jumlah: 300000 }); // DP
    (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });

    await service.onProductionCompleted('order-1');

    expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
    expect(prisma.invoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        jenis: 'PELUNASAN',
        jumlah: 700000, // 1.000.000 subtotal - 300.000 DP
      }),
    });
  });

  it('should be a NO-OP on duplicate delivery (invoice already exists)', async () => {
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
      id: 'inv-existing',
      orderId: 'order-1',
      jenis: 'PELUNASAN',
    });

    await service.onProductionCompleted('order-1');

    // TIDAK ada invoice ganda
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('should create invoice EXACTLY ONCE when the same event is delivered twice', async () => {
    // Delivery 1: belum ada invoice
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });
    // Delivery 2: invoice sudah ada dari delivery pertama
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'inv-1' });

    await service.onProductionCompleted('order-1');
    await service.onProductionCompleted('order-1'); // duplikat

    expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
  });
});
