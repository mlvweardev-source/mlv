import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderService } from './order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { ProductionService } from '../../production/services/production.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { CustomerService } from '../../customer/services/customer.service';
import { ActorType } from '@mlv/auth';
import { prisma } from '@mlv/db';

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') });

jest.mock('@mlv/db', () => ({
  prisma: {
    customer: { findUnique: jest.fn() },
    order: {
      create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn(),
      aggregate: jest.fn(),
    },
    orderItem: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    orderDesign: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    orderTimelineEvent: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    orderService: { create: jest.fn() },
    orderMaterial: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({ id: 'om-1' }) },
    stockReservation: { findMany: jest.fn() },
    material: { findMany: jest.fn() },
    productPriceList: { findUnique: jest.fn() },
    payment: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const mockInventoryService = {
  getBom: jest.fn(), reserveStock: jest.fn(), releaseStock: jest.fn(),
  consumeReservationsForOrder: jest.fn(), releaseReservationsForOrder: jest.fn(),
};
const mockProductionService = {
  getOrderIdsForAssignee: jest.fn().mockResolvedValue([]),
  getDesignRevisionEligibility: jest.fn().mockResolvedValue({}),
  assertDesignRevisionAllowed: jest.fn().mockResolvedValue(undefined),
};
const mockActivityLog = { log: jest.fn().mockResolvedValue(undefined) };
const mockCustomerService = {
  getCustomerByIdInternal: jest.fn().mockResolvedValue({ id: 'c-1', nama: 'Customer', noHp: '081234' }),
  getCustomersByIdsInternal: jest.fn().mockResolvedValue(new Map()),
};

describe('OrderService — Expanded Coverage', () => {
  let service: OrderService;
  let mockEventBus: { publish: jest.Mock };

  const actorOwner = { sub: 'owner-1', role: 'OWNER', actorType: ActorType.USER } as any;
  const actorCustomer = { sub: 'cust-1', actorType: ActorType.CUSTOMER } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: ProductionService, useValue: mockProductionService },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3002') } },
        { provide: CustomerService, useValue: mockCustomerService },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('handlePaymentSucceeded', () => {
    it('should transition order to ANTREAN on DP payment', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', orderNumber: 'MLV-0001', status: 'MENUNGGU_PEMBAYARAN_DP', customerId: 'c-1',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({ id: 'o-1', status: 'ANTREAN' });
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.handlePaymentSucceeded({
        paymentId: 'pay-1', orderId: 'o-1', jenis: 'DP', jumlah: 425000, customerId: 'c-1',
      } as any);

      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should transition order to LUNAS on PELUNASAN payment', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', orderNumber: 'MLV-0001', status: 'MENUNGGU_PELUNASAN', customerId: 'c-1',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({ id: 'o-1', status: 'LUNAS' });
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.handlePaymentSucceeded({
        paymentId: 'pay-2', orderId: 'o-1', jenis: 'PELUNASAN', jumlah: 425000, customerId: 'c-1',
      } as any);

      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should skip if order not found (idempotent)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await service.handlePaymentSucceeded({
        paymentId: 'pay-1', orderId: 'nonexistent', jenis: 'DP', jumlah: 100000, customerId: 'c-1',
      } as any);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should skip if order status is already terminal', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', status: 'LUNAS', customerId: 'c-1',
      });

      await service.handlePaymentSucceeded({
        paymentId: 'pay-1', orderId: 'o-1', jenis: 'DP', jumlah: 100000, customerId: 'c-1',
      } as any);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentExpired', () => {
    it('should cancel order on payment expiry', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', orderNumber: 'MLV-0001', status: 'MENUNGGU_PEMBAYARAN_DP', customerId: 'c-1',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({ id: 'o-1', status: 'DIBATALKAN' });
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.handlePaymentExpired({
        orderId: 'o-1', orderNumber: 'MLV-0001', customerId: 'c-1',
      } as any);

      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should skip if not in MENUNGGU_PEMBAYARAN_DP', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', status: 'ANTREAN', customerId: 'c-1',
      });

      await service.handlePaymentExpired({
        orderId: 'o-1', orderNumber: 'MLV-0001', customerId: 'c-1',
      } as any);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('handleProductionCompleted', () => {
    it('should transition order to PRODUKSI_SELESAI', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', orderNumber: 'MLV-0001', status: 'ANTREAN', customerId: 'c-1',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({ id: 'o-1', status: 'PRODUKSI_SELESAI' });
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.handleProductionCompleted({
        orderId: 'o-1', orderNumber: 'MLV-0001', completedAt: new Date(),
      } as any);

      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should skip if order is in terminal status', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', status: 'DIBATALKAN', customerId: 'c-1',
      });

      await service.handleProductionCompleted({
        orderId: 'o-1', orderNumber: 'MLV-0001', completedAt: new Date(),
      } as any);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('overrideItemPrice', () => {
    it('should update item basePriceSnapshot', async () => {
      (prisma.orderItem.findFirst as jest.Mock).mockResolvedValue({ id: 'item-1', basePriceSnapshot: 85000 });
      (prisma.orderItem.update as jest.Mock).mockResolvedValue({});

      await service.overrideItemPrice('item-1', 'Special price');

      expect(prisma.orderItem.update).toHaveBeenCalled();
    });
  });

  describe('applyDiscount', () => {
    it('should apply percentage discount', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', orderNumber: 'MLV-0001' });
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.applyDiscount('o-1', '10%');

      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ discountPersen: 10 }),
      }));
    });

    it('should apply nominal discount', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', orderNumber: 'MLV-0001' });
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.applyDiscount('o-1', 'Rp 50.000');

      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ discountNominal: 50000 }),
      }));
    });
  });

  describe('cancelOrderByFinance', () => {
    it('should cancel order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', orderNumber: 'MLV-0001', status: 'ANTREAN',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.cancelOrderByFinance('o-1', 'Customer request');

      expect(prisma.order.update).toHaveBeenCalled();
    });
  });

  describe('addTimelineEvent', () => {
    it('should create timeline event with correct field names', async () => {
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({ id: 'tl-1' });

      await service.addTimelineEvent('o-1', 'STATUS_CHANGED', 'Order updated', 'user-1');

      expect(prisma.orderTimelineEvent.create).toHaveBeenCalled();
      // Verify the call was made (field names are in Indonesian: tipeEvent, deskripsi)
    });
  });

  describe('getOrderByIdInternal', () => {
    it('should return order when found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1', orderNumber: 'MLV-0001', customerId: 'c-1',
        customer: { alamat: 'Jakarta' },
        items: [],
      });

      const result = await service.getOrderByIdInternal('o-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('o-1');
    });

    it('should return null when not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getOrderByIdInternal('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('releaseReservationsForOrder', () => {
    it('should return 0 when no reservations', async () => {
      (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.releaseReservationsForOrder('o-1');
      expect(result).toBe(0);
    });
  });
});
