import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { OrderService } from '../../order/services/order.service';
import { prisma } from '@mlv/db';
import { ShipmentStatus } from '@mlv/db';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    shipment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
  },
}));

describe('ShippingService (Unit)', () => {
  let service: ShippingService;
  let mockEventBus: { publish: jest.Mock };
  let mockOrderService: { getOrderByIdInternal: jest.Mock };

  const mockOrderLunas = {
    id: 'order-1',
    status: 'LUNAS',
    orderNumber: 'MLV-20260715-0001',
    customerId: 'cust-1',
    alamat: 'Jl.测试 123',
  };

  const mockOrderNonLunas = {
    id: 'order-2',
    status: 'MENUNGGU_PELUNASAN',
    orderNumber: 'MLV-20260715-0002',
    customerId: 'cust-1',
    alamat: 'Jl.测试 456',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        {
          provide: EventBusService,
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: OrderService,
          useValue: {
            getOrderByIdInternal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ShippingService>(ShippingService);
    mockEventBus = module.get(EventBusService);
    mockOrderService = module.get(OrderService);
    jest.clearAllMocks();
  });

  describe('createShipment', () => {
    const validDto = {
      orderId: 'order-1',
      kurir: 'JNE',
      noResi: 'JNE123456',
      biayaKirim: 15000,
    };

    it('should create shipment successfully when order is LUNAS', async () => {
      const mockShipment = {
        id: 'ship-1',
        orderId: 'order-1',
        kurir: 'JNE',
        noResi: 'JNE123456',
        status: 'DIKIRIM' as ShipmentStatus,
        alamatPengiriman: 'Jl.测试 123',
        biayaKirim: 15000,
        trackingToken: 'token-abc',
        shippedAt: expect.any(Date),
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.shipment.create as jest.Mock).mockResolvedValue(mockShipment);

      const result = await service.createShipment(validDto);

      expect(result.id).toBe('ship-1');
      expect(result.kurir).toBe('JNE');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'shipment.created',
        expect.objectContaining({
          shipmentId: 'ship-1',
          orderId: 'order-1',
          orderNumber: 'MLV-20260715-0001',
        }),
      );
    });

    it('should set status DICATAT when noResi is not provided', async () => {
      const dtoNoResi = { orderId: 'order-1', kurir: 'SiCepat' };
      const mockShipment = {
        id: 'ship-2',
        orderId: 'order-1',
        kurir: 'SiCepat',
        noResi: null,
        status: 'DICATAT' as ShipmentStatus,
        alamatPengiriman: 'Jl.测试 123',
        biayaKirim: null,
        trackingToken: 'token-def',
        shippedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.shipment.create as jest.Mock).mockResolvedValue(mockShipment);

      const result = await service.createShipment(dtoNoResi);

      expect(result.status).toBe('DICATAT');
      expect(result.shippedAt).toBeNull();
    });

    it('should throw NotFoundException if order does not exist', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(null);

      await expect(service.createShipment(validDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if order status is not LUNAS', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderNonLunas);

      await expect(service.createShipment(validDto)).rejects.toThrow(BadRequestException);
      await expect(service.createShipment(validDto)).rejects.toThrow(
        /Order belum berstatus LUNAS/,
      );
    });

    it('should throw BadRequestException if shipment already exists for order', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-ship' });

      await expect(service.createShipment(validDto)).rejects.toThrow(BadRequestException);
      await expect(service.createShipment(validDto)).rejects.toThrow(/sudah ada/);
    });
  });

  describe('updateShipment', () => {
    const mockShipment = {
      id: 'ship-1',
      orderId: 'order-1',
      kurir: 'JNE',
      noResi: 'JNE123456',
      status: 'DIKIRIM' as ShipmentStatus,
      alamatPengiriman: 'Jl.测试 123',
      biayaKirim: 15000,
      trackingToken: 'token-abc',
      shippedAt: new Date(),
      deliveredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should update shipment fields successfully', async () => {
      const updateDto = { noResi: 'JNE789', biayaKirim: 20000 };
      const updatedShipment = { ...mockShipment, ...updateDto };

      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(mockShipment);
      (prisma.shipment.update as jest.Mock).mockResolvedValue(updatedShipment);

      const result = await service.updateShipment('ship-1', updateDto);

      expect(result.noResi).toBe('JNE789');
      expect(result.biayaKirim).toBe(20000);
    });

    it('should throw NotFoundException if shipment does not exist', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updateShipment('nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    it('should auto-set shippedAt when status transitions to DIKIRIM', async () => {
      const shipmentBelumDikirim = { ...mockShipment, status: 'DICATAT' as ShipmentStatus, shippedAt: null };
      const updatedShipment = {
        ...shipmentBelumDikirim,
        status: 'DIKIRIM' as ShipmentStatus,
        shippedAt: expect.any(Date),
      };

      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(shipmentBelumDikirim);
      (prisma.shipment.update as jest.Mock).mockResolvedValue(updatedShipment);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ orderNumber: 'MLV-20260715-0001' });

      const result = await service.updateShipment('ship-1', { status: 'DIKIRIM' as ShipmentStatus });

      expect(result.status).toBe('DIKIRIM');
      expect(result.shippedAt).toEqual(expect.any(Date));
    });

    it('should publish ShipmentDelivered event when status transitions to DITERIMA', async () => {
      const shipmentDikirim = { ...mockShipment, status: 'DIKIRIM' as ShipmentStatus };
      const updatedShipment = {
        ...shipmentDikirim,
        status: 'DITERIMA' as ShipmentStatus,
        deliveredAt: expect.any(Date),
      };

      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(shipmentDikirim);
      (prisma.shipment.update as jest.Mock).mockResolvedValue(updatedShipment);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ orderNumber: 'MLV-20260715-0001' });

      const result = await service.updateShipment('ship-1', { status: 'DITERIMA' as ShipmentStatus });

      expect(result.status).toBe('DITERIMA');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'shipment.delivered',
        expect.objectContaining({
          shipmentId: 'ship-1',
          orderId: 'order-1',
        }),
      );
    });
  });

  describe('findShipments', () => {
    it('should return all shipments sorted by createdAt desc', async () => {
      const mockShipments = [
        {
          id: 'ship-2',
          orderId: 'order-2',
          kurir: 'SiCepat',
          noResi: 'SC123',
          status: 'DIKIRIM',
          alamatPengiriman: null,
          biayaKirim: 12000,
          trackingToken: 'token-2',
          shippedAt: new Date(),
          deliveredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'ship-1',
          orderId: 'order-1',
          kurir: 'JNE',
          noResi: 'JNE123',
          status: 'DITERIMA',
          alamatPengiriman: null,
          biayaKirim: 15000,
          trackingToken: 'token-1',
          shippedAt: new Date(),
          deliveredAt: new Date(),
          createdAt: new Date(Date.now() - 86400000),
          updatedAt: new Date(),
        },
      ];

      (prisma.shipment.findMany as jest.Mock).mockResolvedValue(mockShipments);

      const result = await service.findShipments();

      expect(result).toHaveLength(2);
      expect(prisma.shipment.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getShipmentById', () => {
    it('should return shipment by id', async () => {
      const mockShipment = {
        id: 'ship-1',
        orderId: 'order-1',
        kurir: 'JNE',
        noResi: 'JNE123',
        status: 'DIKIRIM',
        alamatPengiriman: 'Jl.测试',
        biayaKirim: 15000,
        trackingToken: 'token-1',
        shippedAt: new Date(),
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(mockShipment);

      const result = await service.getShipmentById('ship-1');

      expect(result.id).toBe('ship-1');
    });

    it('should throw NotFoundException if shipment does not exist', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getShipmentById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('publicTracking', () => {
    it('should return minimal tracking info without sensitive data', async () => {
      const mockShipment = {
        id: 'ship-1',
        orderId: 'order-1',
        kurir: 'JNE',
        noResi: 'JNE123',
        status: 'DIKIRIM' as ShipmentStatus,
        trackingToken: 'public-token',
        shippedAt: new Date('2026-07-15T10:00:00Z'),
        deliveredAt: null,
        updatedAt: new Date('2026-07-15T10:00:00Z'),
        order: { orderNumber: 'MLV-20260715-0001' },
      };

      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(mockShipment);

      const result = await service.publicTracking('public-token');

      expect(result.orderNumber).toBe('MLV-20260715-0001');
      expect(result.status).toBe('Dalam Pengiriman'); // Public label
      expect(result.kurir).toBe('JNE');
      expect(result.noResi).toBe('JNE123');
      expect(result.shippedAt).toEqual(expect.any(Date));
      expect(result.deliveredAt).toBeNull();
    });

    it('should throw NotFoundException if tracking token is invalid', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.publicTracking('invalid-token')).rejects.toThrow(NotFoundException);
    });

    it('should return correct public status labels', async () => {
      const testCases: Array<{ status: ShipmentStatus; expectedLabel: string }> = [
        { status: 'DICATAT', expectedLabel: 'Siap Dikirim' },
        { status: 'DIKIRIM', expectedLabel: 'Dalam Pengiriman' },
        { status: 'DALAM_TRANSIT', expectedLabel: 'Sedang Transit' },
        { status: 'DITERIMA', expectedLabel: 'Sudah Diterima' },
      ];

      for (const tc of testCases) {
        const mockShipment = {
          id: 'ship-1',
          orderId: 'order-1',
          kurir: 'JNE',
          noResi: null,
          status: tc.status,
          trackingToken: 'token-1',
          shippedAt: null,
          deliveredAt: null,
          updatedAt: new Date(),
          order: { orderNumber: 'MLV-20260715-0001' },
        };

        (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(mockShipment);

        const result = await service.publicTracking('token-1');
        expect(result.status).toBe(tc.expectedLabel);
      }
    });
  });

  describe('publicTrackingByOrderId', () => {
    it('should return tracking info by orderId', async () => {
      const mockShipment = {
        id: 'ship-1',
        orderId: 'order-1',
        kurir: 'SiCepat',
        noResi: 'SC456',
        status: 'DITERIMA' as ShipmentStatus,
        trackingToken: 'token-xyz',
        shippedAt: new Date(),
        deliveredAt: new Date(),
        updatedAt: new Date(),
        order: { orderNumber: 'MLV-20260715-0001' },
      };

      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(mockShipment);

      const result = await service.publicTrackingByOrderId('order-1');

      expect(result.orderNumber).toBe('MLV-20260715-0001');
      expect(result.status).toBe('Sudah Diterima');
    });

    it('should throw NotFoundException if no shipment for order', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.publicTrackingByOrderId('order-without-shipment')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
