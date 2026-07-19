import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { OrderService } from '../../order/services/order.service';
import { CustomerService } from '../../customer/services/customer.service';
import { prisma } from '@mlv/db';
import type { ShipmentStatus } from '@mlv/db';

// Mock @mlv/db — HANYA tabel Shipping Domain.
// Tabel Order/Customer TIDAK di-mock di sini: ShippingService dilarang
// menyentuhnya langsung (DDD §4.1) — akses lewat OrderService yang di-mock.
// ShipmentStatus disediakan sebagai VALUE karena dipakai @IsEnum di DTO.
jest.mock('@mlv/db', () => ({
  ShipmentStatus: {
    DICATAT: 'DICATAT',
    DIKIRIM: 'DIKIRIM',
    DALAM_TRANSIT: 'DALAM_TRANSIT',
    DITERIMA: 'DITERIMA',
  },
  prisma: {
    shipment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(), // Fase 12 Bagian 2: getShipmentForOrder
      update: jest.fn(),
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
    alamat: 'Jl. Merdeka No. 123, Bandung',
  };

  const mockOrderBelumLunas = {
    id: 'order-2',
    status: 'MENUNGGU_PELUNASAN',
    orderNumber: 'MLV-20260715-0002',
    customerId: 'cust-1',
    alamat: 'Jl. Sudirman No. 456, Jakarta',
  };

  const baseShipment = {
    id: 'ship-1',
    orderId: 'order-1',
    kurir: 'JNE',
    noResi: 'JNE123456',
    status: 'DIKIRIM' as ShipmentStatus,
    alamatPengiriman: 'Jl. Merdeka No. 123, Bandung',
    biayaKirim: 15000,
    trackingToken: 'token-abc',
    shippedAt: new Date(),
    deliveredAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        {
          provide: EventBusService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: OrderService,
          useValue: { getOrderByIdInternal: jest.fn() },
        },
        {
          // Fase 8: kontak pelanggan diambil via CustomerService sebelum
          // publish ShipmentCreated (payload event lengkap).
          provide: CustomerService,
          useValue: {
            getCustomerByIdInternal: jest.fn().mockResolvedValue({
              id: 'cust-1',
              nama: 'Budi Santoso',
              noHp: '+628123456789',
              email: null,
            }),
          },
        },
        // ActivityLogService (Fase 9.4)
        {
          provide: ActivityLogService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ShippingService>(ShippingService);
    mockEventBus = module.get(EventBusService);
    mockOrderService = module.get(OrderService);
    jest.clearAllMocks();
  });

  // ==========================================
  // POST /shipments — gate LUNAS
  // ==========================================

  describe('createShipment', () => {
    const validDto = {
      orderId: 'order-1',
      kurir: 'JNE',
      noResi: 'JNE123456',
      biayaKirim: 15000,
    };

    it('should create shipment + publish ShipmentCreated when order is LUNAS', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.shipment.create as jest.Mock).mockResolvedValue(baseShipment);

      const result = await service.createShipment(validDto);

      expect(result.id).toBe('ship-1');
      expect(result.kurir).toBe('JNE');
      // Validasi order via OrderService, BUKAN prisma.order (DDD §4.1)
      expect(mockOrderService.getOrderByIdInternal).toHaveBeenCalledWith('order-1');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'shipment.created',
        expect.objectContaining({
          shipmentId: 'ship-1',
          orderId: 'order-1',
          orderNumber: 'MLV-20260715-0001',
          trackingToken: 'token-abc',
        }),
      );
    });

    it('should default alamatPengiriman to customer alamat from OrderService', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.shipment.create as jest.Mock).mockResolvedValue(baseShipment);

      await service.createShipment({ orderId: 'order-1', kurir: 'JNE' });

      expect(prisma.shipment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alamatPengiriman: 'Jl. Merdeka No. 123, Bandung',
        }),
      });
    });

    it('should use alamatPengiriman override when provided', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.shipment.create as jest.Mock).mockResolvedValue(baseShipment);

      await service.createShipment({
        orderId: 'order-1',
        kurir: 'JNE',
        alamatPengiriman: 'Alamat kantor: Jl. Asia Afrika 8',
      });

      expect(prisma.shipment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alamatPengiriman: 'Alamat kantor: Jl. Asia Afrika 8',
        }),
      });
    });

    it('should set status DICATAT (no shippedAt) when noResi is not provided', async () => {
      const shipmentDicatat = {
        ...baseShipment,
        id: 'ship-2',
        kurir: 'SiCepat',
        noResi: null,
        status: 'DICATAT' as ShipmentStatus,
        biayaKirim: null,
        shippedAt: null,
      };

      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.shipment.create as jest.Mock).mockResolvedValue(shipmentDicatat);

      const result = await service.createShipment({ orderId: 'order-1', kurir: 'SiCepat' });

      expect(result.status).toBe('DICATAT');
      expect(result.shippedAt).toBeNull();
      expect(prisma.shipment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'DICATAT', shippedAt: null }),
      });
    });

    it('should throw NotFoundException if order does not exist', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(null);

      await expect(service.createShipment(validDto)).rejects.toThrow(NotFoundException);
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('should REJECT with clear message if order status is not LUNAS (gate §23)', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderBelumLunas);

      await expect(service.createShipment(validDto)).rejects.toThrow(BadRequestException);
      await expect(service.createShipment(validDto)).rejects.toThrow(/belum berstatus LUNAS/);
      expect(prisma.shipment.create).not.toHaveBeenCalled();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if shipment already exists for order', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-ship' });

      await expect(service.createShipment(validDto)).rejects.toThrow(/sudah ada/);
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // PATCH /shipments/:id
  // ==========================================

  describe('updateShipment', () => {
    it('should update shipment fields successfully', async () => {
      const updateDto = { noResi: 'JNE789', biayaKirim: 20000 };
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(baseShipment);
      (prisma.shipment.update as jest.Mock).mockResolvedValue({ ...baseShipment, ...updateDto });

      const result = await service.updateShipment('ship-1', updateDto);

      expect(result.noResi).toBe('JNE789');
      expect(result.biayaKirim).toBe(20000);
      expect(mockEventBus.publish).not.toHaveBeenCalled(); // bukan transisi DITERIMA
    });

    it('should throw NotFoundException if shipment does not exist', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updateShipment('nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    it('should auto-set shippedAt when status transitions to DIKIRIM', async () => {
      const dicatat = {
        ...baseShipment,
        status: 'DICATAT' as ShipmentStatus,
        shippedAt: null,
      };
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(dicatat);
      (prisma.shipment.update as jest.Mock).mockResolvedValue({
        ...dicatat,
        status: 'DIKIRIM' as ShipmentStatus,
        shippedAt: new Date(),
      });

      const result = await service.updateShipment('ship-1', {
        status: 'DIKIRIM' as ShipmentStatus,
      });

      expect(result.status).toBe('DIKIRIM');
      expect(prisma.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shippedAt: expect.any(Date) }),
        }),
      );
    });

    it('should publish ShipmentDelivered (orderNumber via OrderService) on transition to DITERIMA', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(baseShipment);
      (prisma.shipment.update as jest.Mock).mockResolvedValue({
        ...baseShipment,
        status: 'DITERIMA' as ShipmentStatus,
        deliveredAt: new Date(),
      });
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);

      const result = await service.updateShipment('ship-1', {
        status: 'DITERIMA' as ShipmentStatus,
      });

      expect(result.status).toBe('DITERIMA');
      // orderNumber diambil via OrderService, BUKAN prisma.order (DDD §4.1)
      expect(mockOrderService.getOrderByIdInternal).toHaveBeenCalledWith('order-1');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'shipment.delivered',
        expect.objectContaining({
          shipmentId: 'ship-1',
          orderId: 'order-1',
          orderNumber: 'MLV-20260715-0001',
        }),
      );
    });

    it('should NOT publish ShipmentDelivered again if already DITERIMA (idempotent)', async () => {
      const diterima = {
        ...baseShipment,
        status: 'DITERIMA' as ShipmentStatus,
        deliveredAt: new Date(),
      };
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(diterima);
      (prisma.shipment.update as jest.Mock).mockResolvedValue(diterima);

      await service.updateShipment('ship-1', { status: 'DITERIMA' as ShipmentStatus });

      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // GET /shipments & /shipments/:id (staff)
  // ==========================================

  describe('findShipments', () => {
    it('should return all shipments sorted by createdAt desc', async () => {
      (prisma.shipment.findMany as jest.Mock).mockResolvedValue([
        { ...baseShipment, id: 'ship-2' },
        baseShipment,
      ]);

      const result = await service.findShipments();

      expect(result).toHaveLength(2);
      expect(prisma.shipment.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getShipmentById', () => {
    it('should return shipment by id', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(baseShipment);

      const result = await service.getShipmentById('ship-1');

      expect(result.id).toBe('ship-1');
    });

    it('should throw NotFoundException if shipment does not exist', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getShipmentById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ==========================================
  // Public tracking — via TOKEN UNIK (bukan orderId)
  // ==========================================

  describe('publicTracking (via token)', () => {
    it('should look up by trackingToken and return ONLY non-sensitive fields', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(baseShipment);
      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);

      const result = await service.publicTracking('token-abc');

      // Lookup HARUS pakai trackingToken, bukan orderId
      expect(prisma.shipment.findUnique).toHaveBeenCalledWith({
        where: { trackingToken: 'token-abc' },
      });

      expect(result.orderNumber).toBe('MLV-20260715-0001');
      expect(result.status).toBe('Dalam Pengiriman');
      expect(result.kurir).toBe('JNE');
      expect(result.noResi).toBe('JNE123456');

      // TIDAK boleh bocor data sensitif di response publik
      const keys = Object.keys(result);
      expect(keys).not.toContain('biayaKirim');
      expect(keys).not.toContain('alamatPengiriman');
      expect(keys).not.toContain('trackingToken');
      expect(keys).not.toContain('orderId');
      expect(keys).not.toContain('customerId');
    });

    it('should throw NotFoundException (404) for invalid token', async () => {
      (prisma.shipment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.publicTracking('invalid-token')).rejects.toThrow(NotFoundException);
    });

    it('should return correct public status labels for all statuses', async () => {
      const cases: Array<{ status: ShipmentStatus; label: string }> = [
        { status: 'DICATAT', label: 'Siap Dikirim' },
        { status: 'DIKIRIM', label: 'Dalam Pengiriman' },
        { status: 'DALAM_TRANSIT', label: 'Sedang Transit' },
        { status: 'DITERIMA', label: 'Sudah Diterima' },
      ];

      mockOrderService.getOrderByIdInternal.mockResolvedValue(mockOrderLunas);

      for (const tc of cases) {
        (prisma.shipment.findUnique as jest.Mock).mockResolvedValue({
          ...baseShipment,
          status: tc.status,
        });

        const result = await service.publicTracking('token-abc');
        expect(result.status).toBe(tc.label);
      }
    });
  });

  /**
   * Fase 12 Bagian 2 (koreksi DDD §4.1):
   * getShipmentForOrder = method internal untuk CustomerChatService bangun
   * konteks AI auto-reply. Beda dengan endpoint publik getShipmentById:
   * - lookup by orderId (bukan shipmentId)
   * - return null (bukan throw) kalau belum ada shipment
   * - return field minimal siap-konsumsi (tanpa trackingToken, biayaKirim, dll)
   */
  describe('getShipmentForOrder (Fase 12 Bagian 2 — cross-domain internal)', () => {
    it('should return shipment fields when one exists for the order', async () => {
      (prisma.shipment.findFirst as jest.Mock).mockResolvedValue({
        id: 'ship-1',
        orderId: 'order-1',
        kurir: 'JNE',
        noResi: 'JNE123456',
        status: 'DIKIRIM',
        alamatPengiriman: 'Jl. Test',
        biayaKirim: 15000,
        trackingToken: 'uuid-tracking',
        shippedAt: new Date('2026-07-19T08:00:00Z'),
        deliveredAt: null,
        createdAt: new Date('2026-07-19'),
        updatedAt: new Date('2026-07-19'),
      });

      const result = await service.getShipmentForOrder('order-1');

      expect(prisma.shipment.findFirst).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        id: 'ship-1',
        kurir: 'JNE',
        noResi: 'JNE123456',
        status: 'DIKIRIM',
        shippedAt: new Date('2026-07-19T08:00:00Z'),
        deliveredAt: null,
      });
    });

    it('should return null when no shipment exists (not throw)', async () => {
      (prisma.shipment.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getShipmentForOrder('order-no-shipment');

      expect(result).toBeNull();
    });

    it('should NOT include sensitive fields (trackingToken, biayaKirim, alamatPengiriman, customerId)', async () => {
      (prisma.shipment.findFirst as jest.Mock).mockResolvedValue({
        id: 'ship-1',
        orderId: 'order-1',
        kurir: 'JNE',
        noResi: 'JNE123456',
        status: 'DIKIRIM',
        alamatPengiriman: 'Jl. Test',
        biayaKirim: 15000,
        trackingToken: 'uuid-tracking',
        shippedAt: new Date(),
        deliveredAt: null,
      });

      const result = await service.getShipmentForOrder('order-1');

      expect(result).not.toHaveProperty('trackingToken');
      expect(result).not.toHaveProperty('biayaKirim');
      expect(result).not.toHaveProperty('alamatPengiriman');
      expect(result).not.toHaveProperty('orderId');
    });
  });
});
