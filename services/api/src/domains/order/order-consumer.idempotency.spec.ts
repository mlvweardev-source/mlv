import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './services/order.service';
import { InventoryService } from '../inventory/services/inventory.service';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_NAMES } from '@mlv/types';

// Mock Prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    orderTimelineEvent: {
      create: jest.fn(),
    },
  },
}));

import { prisma } from '@mlv/db';

/**
 * Idempotency tests untuk consumer event Order Domain (§16).
 *
 * Prinsip: konsumen TIDAK mengandalkan dedup bawaan BullMQ — cek state
 * DB dulu sebelum apply efek (pola sama dengan idempotency webhook
 * Midtrans di Fase 5). Event yang dikirim dua kali harus menghasilkan
 * efek TEPAT SATU KALI.
 */
describe('OrderService - Event Consumer Idempotency (§16)', () => {
  let service: OrderService;
  let mockEventBus: { publish: jest.Mock };

  const dpEvent = {
    paymentId: 'pay-1',
    orderId: 'order-1',
    jenis: 'DP' as const,
    jumlah: 500000,
    customerId: 'customer-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockEventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: InventoryService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('handlePaymentSucceeded (DP)', () => {
    it('should transition order to ANTREAN and publish OrderConfirmed on first delivery', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        status: 'MENUNGGU_PEMBAYARAN_DP',
      });

      await service.handlePaymentSucceeded(dpEvent);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'ANTREAN' },
      });
      expect(prisma.orderTimelineEvent.create).toHaveBeenCalledTimes(1);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        EVENT_NAMES.OrderConfirmed,
        expect.objectContaining({ orderId: 'order-1' }),
      );
    });

    it('should be a NO-OP on duplicate delivery (order already ANTREAN)', async () => {
      // Simulasi delivery kedua: order sudah ANTREAN dari delivery pertama
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        status: 'ANTREAN', // <-- state DB menunjukkan sudah diproses
      });

      await service.handlePaymentSucceeded(dpEvent);

      // TIDAK ada efek ganda
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderTimelineEvent.create).not.toHaveBeenCalled();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('should apply effect EXACTLY ONCE when the same event is delivered twice', async () => {
      // Delivery 1: status masih MENUNGGU_PEMBAYARAN_DP
      (prisma.order.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        status: 'MENUNGGU_PEMBAYARAN_DP',
      });
      // Delivery 2: status sudah ANTREAN (efek delivery 1)
      (prisma.order.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        status: 'ANTREAN',
      });

      await service.handlePaymentSucceeded(dpEvent);
      await service.handlePaymentSucceeded(dpEvent); // duplikat

      // Efek terjadi TEPAT SATU KALI
      expect(prisma.order.update).toHaveBeenCalledTimes(1);
      expect(prisma.orderTimelineEvent.create).toHaveBeenCalledTimes(1);
      expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePaymentSucceeded (PELUNASAN)', () => {
    const pelunasanEvent = { ...dpEvent, jenis: 'PELUNASAN' as const };

    it('should transition to LUNAS on first delivery', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'MENUNGGU_PELUNASAN',
      });

      await service.handlePaymentSucceeded(pelunasanEvent);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'LUNAS' },
      });
    });

    it('should be a NO-OP on duplicate delivery (order already LUNAS)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'LUNAS',
      });

      await service.handlePaymentSucceeded(pelunasanEvent);

      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderTimelineEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('handleProductionCompleted', () => {
    it('should transition to MENUNGGU_PELUNASAN on first delivery', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'ANTREAN',
      });

      await service.handleProductionCompleted({ orderId: 'order-1', orderNumber: 'MLV-001' });

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'MENUNGGU_PELUNASAN' },
      });
    });

    it('should be a NO-OP on duplicate delivery (already MENUNGGU_PELUNASAN)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-001',
        status: 'MENUNGGU_PELUNASAN',
      });

      await service.handleProductionCompleted({ orderId: 'order-1', orderNumber: 'MLV-001' });

      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderTimelineEvent.create).not.toHaveBeenCalled();
    });
  });
});
