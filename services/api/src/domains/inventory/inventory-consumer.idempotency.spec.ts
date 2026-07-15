import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './services/inventory.service';
import { EventBusService } from '../../event-bus/event-bus.service';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    warehouse: {
      findFirst: jest.fn(),
    },
    stockBalance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    stockReservation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    stockMovement: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
    $queryRaw: jest.fn(),
  },
}));

import { prisma } from '@mlv/db';

/**
 * Idempotency tests untuk consumer event Inventory Domain (§16).
 *
 * OrderConfirmed (→ deduction) dan PaymentFailed/Expired (→ release)
 * yang dikirim dua kali TIDAK boleh menghasilkan efek ganda — hanya
 * reservasi berstatus ACTIVE yang diproses.
 */
describe('InventoryService - Event Consumer Idempotency (§16)', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: EventBusService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    jest.clearAllMocks();
  });

  describe('consumeReservationsForOrder (OrderConfirmed → deduction)', () => {
    it('should deduct all ACTIVE reservations on first delivery', async () => {
      const reservation = {
        id: 'res-1',
        orderId: 'order-1',
        materialId: 'mat-1',
        qty: 5,
        status: 'ACTIVE',
      };

      (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([reservation]);
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({ id: 'wh-1' });
      (prisma.stockReservation.findUnique as jest.Mock).mockResolvedValue(reservation);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 100, qty_reserved: 5 },
      ]);
      (prisma.stockReservation.update as jest.Mock).mockResolvedValue({
        ...reservation,
        status: 'CONSUMED',
      });

      const count = await service.consumeReservationsForOrder('order-1');

      expect(count).toBe(1);
      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { status: 'CONSUMED' },
      });
      // Movement OUT tercatat (§23 Fase 2: semua perubahan stok lewat stock_movements)
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tipe: 'OUT', qty: 5 }),
      });
    });

    it('should be a NO-OP on duplicate delivery (reservations already CONSUMED)', async () => {
      // Delivery kedua: tidak ada lagi reservasi ACTIVE (sudah CONSUMED)
      (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([]);

      const count = await service.consumeReservationsForOrder('order-1');

      expect(count).toBe(0);
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('releaseReservationsForOrder (PaymentFailed/Expired → release)', () => {
    it('should be a NO-OP on duplicate delivery (reservations already RELEASED)', async () => {
      (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([]);

      const count = await service.releaseReservationsForOrder('order-1');

      expect(count).toBe(0);
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
  });
});
