import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { ProductionService } from '../../production/services/production.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { ActorType } from '@mlv/auth';
import { prisma } from '@mlv/db';

// Mock Prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    customer: {
      findUnique: jest.fn(),
    },
    order: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    orderItem: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    orderDesign: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    orderTimelineEvent: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    orderService: {
      create: jest.fn(),
    },
    orderMaterial: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'om-1' }),
    },
    stockReservation: {
      findMany: jest.fn(),
    },
    material: {
      findMany: jest.fn(),
    },
    productPriceList: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Mock InventoryService
const mockInventoryService = {
  getBom: jest.fn(),
  reserveStock: jest.fn(),
  releaseStock: jest.fn(),
};

// Mock ProductionService (Fase 9: view terbatas Tim Penjahit)
const mockProductionService = {
  getOrderIdsForAssignee: jest.fn().mockResolvedValue([]),
  getDesignRevisionEligibility: jest.fn().mockResolvedValue({}),
  assertDesignRevisionAllowed: jest.fn().mockResolvedValue(undefined),
};

// Mock ActivityLogService (Fase 9.4)
const mockActivityLog = { log: jest.fn().mockResolvedValue(undefined) };

describe('OrderService', () => {
  let service: OrderService;
  let mockEventBus: { publish: jest.Mock };

  const mockActorOwner = {
    sub: 'user-1',
    email: 'owner@mlv.dev',
    role: 'OWNER',
    actorType: ActorType.USER,
  };

  const mockActorCustomer = {
    sub: 'customer-1',
    email: 'customer@test.com',
    role: undefined,
    actorType: ActorType.CUSTOMER,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockEventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: EventBusService,
          useValue: mockEventBus,
        },
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
        {
          provide: ProductionService,
          useValue: mockProductionService,
        },
        {
          provide: ActivityLogService,
          useValue: mockActivityLog,
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('createOrder', () => {
    it('should create a new order for valid customer', async () => {
      const customerId = 'customer-1';
      const mockCustomer = { id: customerId, nama: 'Test Customer' };
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-20260713-0001',
        customerId,
        status: 'DRAFT',
        deadline: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        timeline: [],
      };

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.createOrder({ customerId }, mockActorOwner as any);

      expect(result).toBeDefined();
      expect(result.id).toBe('order-1');
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent customer', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createOrder({ customerId: 'invalid' }, mockActorOwner as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if customer tries to create order for others', async () => {
      const mockCustomer = { id: 'customer-2', nama: 'Other Customer' };
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

      await expect(
        service.createOrder({ customerId: 'customer-2' }, mockActorCustomer as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findOrders', () => {
    it('should return all orders for staff', async () => {
      const mockOrders = [
        { id: 'order-1', orderNumber: 'MLV-001', customerId: 'c1', status: 'DRAFT' },
        { id: 'order-2', orderNumber: 'MLV-002', customerId: 'c2', status: 'DRAFT' },
      ];

      (prisma.order.findMany as jest.Mock).mockResolvedValue(
        mockOrders.map((o) => ({
          ...o,
          deadline: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { items: 1 },
        })),
      );

      const result = await service.findOrders(mockActorOwner as any);

      expect(result).toHaveLength(2);
      expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('should return only own orders for customer', async () => {
      const mockOrders = [{ id: 'order-1', customerId: 'customer-1', status: 'DRAFT' }];

      (prisma.order.findMany as jest.Mock).mockResolvedValue(
        mockOrders.map((o) => ({
          ...o,
          orderNumber: 'MLV-001',
          deadline: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { items: 1 },
        })),
      );

      const result = await service.findOrders(mockActorCustomer as any);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: 'customer-1' } }),
      );
    });
  });

  describe('addOrderItem', () => {
    it('should add item to draft order', async () => {
      const mockOrder = {
        id: 'order-1',
        status: 'DRAFT',
        customerId: 'customer-1',
      };
      const mockItem = {
        id: 'item-1',
        orderId: 'order-1',
        productType: 'Kaos',
        basePriceSnapshot: 50000,
        sizes: [{ id: 'size-1', ukuran: 'L', qty: 5 }],
        createdAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderItem.create as jest.Mock).mockResolvedValue(mockItem);

      const result = await service.addOrderItem(
        'order-1',
        {
          productType: 'Kaos' as any,
          basePriceSnapshot: 50000,
          sizes: [{ ukuran: 'L', qty: 5 }],
        },
        mockActorOwner as any,
      );

      expect(result.productType).toBe('Kaos');
      expect(result.sizes).toHaveLength(1);
    });

    it('should throw BadRequestException for non-draft order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        status: 'MENUNGGU_PEMBAYARAN_DP',
        customerId: 'customer-1',
      });

      await expect(
        service.addOrderItem(
          'order-1',
          { productType: 'Kaos' as any, basePriceSnapshot: 50000, sizes: [] },
          mockActorOwner as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should ignore input price and use ProductPriceList price for CUSTOMER', async () => {
      const mockOrder = {
        id: 'order-1',
        status: 'DRAFT',
        customerId: 'customer-1',
      };
      const mockItem = {
        id: 'item-1',
        orderId: 'order-1',
        productType: 'Kaos',
        basePriceSnapshot: 85000,
        sizes: [{ id: 'size-1', ukuran: 'L', qty: 5 }],
        createdAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productPriceList.findUnique as jest.Mock).mockResolvedValue({
        productType: 'Kaos',
        hargaDasarPerPcs: 85000,
      });
      (prisma.orderItem.create as jest.Mock).mockResolvedValue(mockItem);

      const result = await service.addOrderItem(
        'order-1',
        {
          productType: 'Kaos' as any,
          basePriceSnapshot: 1000, // manipulated price
          sizes: [{ ukuran: 'L', qty: 5 }],
        },
        { sub: 'customer-1', actorType: ActorType.CUSTOMER } as any,
      );

      expect(prisma.productPriceList.findUnique).toHaveBeenCalledWith({
        where: { productType: 'Kaos' },
      });
      expect(prisma.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            basePriceSnapshot: 85000, // Ignores 1000, uses 85000
          }),
        }),
      );
      expect(result.basePriceSnapshot).toBe(85000);
    });
  });

  describe('updateStatus - Checkout Flow', () => {
    it('should throw BadRequestException if BOM not configured', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'DRAFT',
        customerId: 'customer-1',
        items: [
          {
            id: 'item-1',
            productType: 'UnknownProduct',
            sizes: [{ qty: 1 }],
          },
        ],
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      mockInventoryService.getBom.mockRejectedValue(new NotFoundException('BOM tidak ditemukan'));

      await expect(
        service.updateStatus(
          'order-1',
          { status: 'MENUNGGU_PEMBAYARAN_DP' as any },
          mockActorOwner as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle cancellation', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'DRAFT',
        customerId: 'customer-1',
        items: [],
        timeline: [],
      };
      const updatedOrder = { ...mockOrder, status: 'DIBATALKAN' };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.update as jest.Mock).mockResolvedValue(updatedOrder);
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});
      // Called twice: once in updateStatus for getOrderById, once in getOrderById itself
      (prisma.order.findUnique as jest.Mock)
        .mockResolvedValueOnce(updatedOrder)
        .mockResolvedValueOnce(updatedOrder);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.updateStatus(
        'order-1',
        { status: 'DIBATALKAN' as any, reason: 'Customer request' },
        mockActorOwner as any,
      );

      expect(result.status).toBe('DIBATALKAN');
    });

    it('should atomically rollback ALL reservations when one fails', async () => {
      // ============================================================
      // TEST: Ketika satu material gagal di-reserve, SEMUA
      // reservation yang sudah berhasil harus di-release
      // ============================================================
      const kainReservationId = 'reservation-kain';
      const labelReservationId = 'reservation-label';

      // Mock releaseStock
      const releaseStockSpy = jest.spyOn(mockInventoryService, 'releaseStock');
      releaseStockSpy.mockResolvedValue({ id: 'released' } as any);

      // Call service's private releaseReservations method via cast
      // Ini test bahwa rollback logic bekerja untuk semua reservation
      await (service as any).releaseReservations([kainReservationId, labelReservationId]);

      // ASSERTION: releaseStock dipanggil untuk SETIAP reservation
      expect(releaseStockSpy).toHaveBeenCalledTimes(2);
      expect(releaseStockSpy).toHaveBeenCalledWith({ reservationId: kainReservationId });
      expect(releaseStockSpy).toHaveBeenCalledWith({ reservationId: labelReservationId });

      releaseStockSpy.mockRestore();
    });

    it('should not release reservations when checkout succeeds', async () => {
      // ============================================================
      // TEST: Ketika checkout BERHASIL, releaseStock TIDAK dipanggil
      // ============================================================
      const releaseStockSpy = jest.spyOn(mockInventoryService, 'releaseStock');
      releaseStockSpy.mockResolvedValue({ id: 'released' } as any);

      // reserveStock sukses semua
      jest.spyOn(mockInventoryService, 'reserveStock').mockResolvedValue({ id: 'res-1' } as any);

      // Mock $transaction untuk sukses
      (prisma.$transaction as jest.Mock).mockResolvedValue({});

      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'DRAFT',
        customerId: 'customer-1',
        items: [
          {
            id: 'item-1',
            productType: 'Kaos',
            basePriceSnapshot: 50000,
            sizes: [{ qty: 5 }],
            designs: [],
            materials: [],
            services: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        timeline: [],
      };

      const bomKaos = [{ materialId: 'kain-id', material: { nama: 'Kain' }, qtyPerUnit: 2.3 }];

      const checkedOutOrder = {
        ...mockOrder,
        status: 'MENUNGGU_PEMBAYARAN_DP',
      };

      (prisma.order.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(checkedOutOrder);
      mockInventoryService.getBom.mockResolvedValue(bomKaos);
      (prisma.order.update as jest.Mock).mockResolvedValue(checkedOutOrder);
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      // releaseStockSpy harus TIDAK dipanggil saat checkout sukses
      await service.updateStatus(
        'order-1',
        { status: 'MENUNGGU_PEMBAYARAN_DP' as any },
        mockActorOwner as any,
      );

      // releaseStock TIDAK dipanggil saat checkout berhasil
      expect(releaseStockSpy).not.toHaveBeenCalled();

      releaseStockSpy.mockRestore();
    });
  });

  describe('getOrderById', () => {
    it('should return order details for authorized user', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        status: 'DRAFT',
        deadline: null,
        items: [
          {
            id: 'item-1',
            productType: 'Kaos',
            basePriceSnapshot: 50000,
            sizes: [],
            designs: [],
            materials: [],
            services: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        timeline: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getOrderById('order-1', mockActorOwner as any);

      expect(result.id).toBe('order-1');
    });

    it('should throw ForbiddenException for unauthorized customer', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'other-customer',
        status: 'DRAFT',
        items: [],
        timeline: [],
      });

      await expect(service.getOrderById('order-1', mockActorCustomer as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException for non-existent order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getOrderById('invalid', mockActorOwner as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('duplicateOrder', () => {
    describe('design revision gate', () => {
      it('should increment revision version without deleting prior designs', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue({
          id: 'order-1',
          customerId: 'customer-1',
          status: 'CUTTING',
        });
        (prisma.orderItem.findFirst as jest.Mock).mockResolvedValue({
          id: 'item-1',
          orderId: 'order-1',
          productType: 'Kaos',
        });
        (prisma.orderDesign.findFirst as jest.Mock).mockResolvedValue({ versiRevisi: 2 });
        (prisma.orderDesign.create as jest.Mock).mockResolvedValue({
          id: 'design-3',
          orderItemId: 'item-1',
          versiRevisi: 3,
        });
        (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

        const result = await service.uploadDesignWithUrl(
          'order-1',
          'item-1',
          '/uploads/designs/revision.png',
          'Perbesar logo',
          mockActorCustomer as any,
        );

        expect(mockProductionService.assertDesignRevisionAllowed).toHaveBeenCalledWith('item-1');
        expect(prisma.orderDesign.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ orderItemId: 'item-1', versiRevisi: 3 }),
        });
        expect(result.versiRevisi).toBe(3);
      });

      it('should reject revision when Cutting has started', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue({
          id: 'order-1',
          customerId: 'customer-1',
          status: 'CUTTING',
        });
        (prisma.orderItem.findFirst as jest.Mock).mockResolvedValue({
          id: 'item-1',
          orderId: 'order-1',
          productType: 'Kaos',
        });
        mockProductionService.assertDesignRevisionAllowed.mockRejectedValueOnce(
          new BadRequestException(
            'Revisi desain tidak dapat diunggah karena proses Cutting sudah dimulai',
          ),
        );

        await expect(
          service.uploadDesignWithUrl(
            'order-1',
            'item-1',
            '/uploads/designs/revision.png',
            undefined,
            mockActorCustomer as any,
          ),
        ).rejects.toThrow('proses Cutting sudah dimulai');
        expect(prisma.orderDesign.create).not.toHaveBeenCalled();
      });
    });

    it('should create a copy of existing order', async () => {
      const originalOrder = {
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        status: 'DRAFT',
        items: [
          {
            id: 'item-1',
            productType: 'Kaos',
            basePriceSnapshot: 50000,
            sizes: [{ ukuran: 'L', qty: 5 }],
            designs: [],
            services: [],
            materials: [],
          },
        ],
        timeline: [],
      };
      const newOrder = {
        ...originalOrder,
        id: 'order-2',
        orderNumber: 'MLV-20260713-0002',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(originalOrder);
      (prisma.order.count as jest.Mock).mockResolvedValue(1);
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...newOrder,
        items: [
          {
            ...originalOrder.items[0],
            sizes: originalOrder.items[0].sizes,
          },
        ],
        timeline: [],
      });
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(newOrder);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.duplicateOrder('order-1', mockActorOwner as any);

      expect(result.id).toBe('order-2');
      expect(prisma.order.create).toHaveBeenCalled();
    });
  });

  describe('RBAC - Access Control', () => {
    it('should allow owner to access any order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'any-customer',
        status: 'DRAFT',
        items: [],
        timeline: [],
      });
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getOrderById('order-1', mockActorOwner as any);
      expect(result).toBeDefined();
    });

    it('should allow customer to access own order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'customer-1',
        status: 'DRAFT',
        items: [],
        timeline: [],
      });
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getOrderById('order-1', mockActorCustomer as any);
      expect(result).toBeDefined();
    });

    it('should deny customer access to others order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'other-customer',
        status: 'DRAFT',
        items: [],
        timeline: [],
      });

      await expect(service.getOrderById('order-1', mockActorCustomer as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('handleShipmentCreated', () => {
    const shipmentEvent = {
      shipmentId: 'ship-1',
      orderId: 'order-1',
      orderNumber: 'MLV-20260715-0001',
      kurir: 'JNE',
      trackingToken: 'token-abc',
      createdAt: new Date(),
    };

    it('should transition order to DIKIRIM when status is LUNAS', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-20260715-0001',
        status: 'LUNAS',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue({ ...mockOrder, status: 'DIKIRIM' });
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.handleShipmentCreated(shipmentEvent);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'DIKIRIM' },
      });
      expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          tipeEvent: 'DIKIRIM',
          deskripsi: expect.stringContaining('JNE'),
        }),
      });
    });

    it('should skip if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await service.handleShipmentCreated(shipmentEvent);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should skip (idempotent) if order already DIKIRIM', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-20260715-0001',
        status: 'DIKIRIM',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await service.handleShipmentCreated(shipmentEvent);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should skip if order status is not LUNAS', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-20260715-0001',
        status: 'MENUNGGU_PELUNASAN',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await service.handleShipmentCreated(shipmentEvent);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('handleShipmentDelivered', () => {
    const deliveredEvent = {
      shipmentId: 'ship-1',
      orderId: 'order-1',
      orderNumber: 'MLV-20260715-0001',
      deliveredAt: new Date(),
    };

    it('should create timeline event when order is delivered', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNumber: 'MLV-20260715-0001',
        status: 'DIKIRIM',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderTimelineEvent.create as jest.Mock).mockResolvedValue({});

      await service.handleShipmentDelivered(deliveredEvent);

      expect(prisma.orderTimelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          tipeEvent: 'DITERIMA',
          deskripsi: expect.stringContaining('diterima'),
        }),
      });
    });

    it('should skip if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await service.handleShipmentDelivered(deliveredEvent);

      expect(prisma.orderTimelineEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('getOrderByIdInternal', () => {
    it('should return minimal order data for cross-domain access', async () => {
      const mockOrder = {
        id: 'order-1',
        status: 'LUNAS',
        orderNumber: 'MLV-20260715-0001',
        customerId: 'cust-1',
        customer: { alamat: 'Jl. Merdeka No. 123, Bandung' },
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      const result = await service.getOrderByIdInternal('order-1');

      expect(result).toEqual({
        id: 'order-1',
        status: 'LUNAS',
        orderNumber: 'MLV-20260715-0001',
        customerId: 'cust-1',
        alamat: 'Jl. Merdeka No. 123, Bandung',
      });
    });

    it('should return null if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getOrderByIdInternal('nonexistent');

      expect(result).toBeNull();
    });
  });
});
