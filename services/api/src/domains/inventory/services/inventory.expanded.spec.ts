import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { prisma } from '@mlv/db';

jest.mock('@mlv/db', () => ({
  prisma: {
    material: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    billOfMaterial: { upsert: jest.fn(), findMany: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    stockBalance: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    stockReservation: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    stockMovement: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    purchaseOrder: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    stockAdjustment: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb) => cb(prisma)),
    $queryRaw: jest.fn(),
  },
}));

describe('InventoryService — Expanded Coverage', () => {
  let service: InventoryService;
  let mockEventBus: { publish: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: EventBusService, useValue: { publish: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    mockEventBus = module.get(EventBusService);
  });

  describe('createStockMovement - type branching', () => {
    it('should create IN movement and increase balance', async () => {
      (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'mov-1', tipe: 'IN' });
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        materialId: 'mat-1', warehouseId: 'wh-1', qtyAvailable: 100, qtyReserved: 0,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 100, qty_reserved: 0 },
      ]);

      const result = await service.createStockMovement({
        materialId: 'mat-1', warehouseId: 'wh-1', tipe: 'IN', qty: 50, refType: 'purchase_order', refId: 'po-1',
      });

      expect(result.id).toBe('mov-1');
      expect(prisma.stockBalance.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException for OUT with insufficient stock', async () => {
      (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'mov-2', tipe: 'OUT' });
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        materialId: 'mat-1', warehouseId: 'wh-1', qtyAvailable: 5, qtyReserved: 0,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 5, qty_reserved: 0 },
      ]);

      await expect(service.createStockMovement({
        materialId: 'mat-1', warehouseId: 'wh-1', tipe: 'OUT', qty: 10,
      })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for ADJUST that makes balance negative', async () => {
      (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'mov-3', tipe: 'ADJUST' });
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        materialId: 'mat-1', warehouseId: 'wh-1', qtyAvailable: 5, qtyReserved: 0,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 5, qty_reserved: 0 },
      ]);

      await expect(service.createStockMovement({
        materialId: 'mat-1', warehouseId: 'wh-1', tipe: 'ADJUST', qty: -10,
      })).rejects.toThrow(BadRequestException);
    });

    it('should create initial balance when none exists', async () => {
      (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'mov-4', tipe: 'IN' });
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 0, qty_reserved: 0 },
      ]);

      await service.createStockMovement({
        materialId: 'mat-1', warehouseId: 'wh-1', tipe: 'IN', qty: 50,
      });

      expect(prisma.stockBalance.create).toHaveBeenCalled();
    });
  });

  describe('releaseStock - edge cases', () => {
    it('should throw NotFoundException if reservation not found', async () => {
      (prisma.stockReservation.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.releaseStock({ reservationId: 'nonexistent' })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if reservation is not ACTIVE', async () => {
      (prisma.stockReservation.findUnique as jest.Mock).mockResolvedValue({
        id: 'res-1', status: 'CONSUMED', materialId: 'mat-1', warehouseId: 'wh-1', qty: 5,
      });
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({ id: 'wh-1' });

      await expect(service.releaseStock({ reservationId: 'res-1' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('deductStock - edge cases', () => {
    it('should throw NotFoundException if reservation not found', async () => {
      (prisma.stockReservation.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.deductStock('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStockAccuracy', () => {
    it('should return 1.0 accuracy when no movements', async () => {
      (prisma.stockMovement.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getStockAccuracy(new Date(), new Date());
      expect(result.accuracy).toBe(1);
      expect(result.totalMovements).toBe(0);
    });
  });

  describe('createPurchaseOrder', () => {
    it('should throw NotFoundException when material not found', async () => {
      (prisma.material.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.createPurchaseOrder({
        supplier: 'Toko Kain', materialId: 'mat-nonexistent', qty: 100, totalBiaya: 500000, tglBeli: '2026-07-19',
      } as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkAvailability - additional cases', () => {
    it('should return available true if there is enough stock', async () => {
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({ id: 'wh-1' });
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue([
        { materialId: 'mat-1', qtyPerUnit: 2.0, material: { nama: 'Kain' } },
      ]);
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        qtyAvailable: 100, qtyReserved: 10, // free: 90, needed: 2*10=20
      });

      const result = await service.checkAvailability('Kaos', 10);
      expect(result.available).toBe(true);
    });

    it('should return available false when BOM has no items', async () => {
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({ id: 'wh-1' });
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.checkAvailability('Unknown', 10);
      expect(result.available).toBe(false);
    });
  });
});
