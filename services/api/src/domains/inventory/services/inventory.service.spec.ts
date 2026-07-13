import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { prisma } from '@mlv/db';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    material: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    billOfMaterial: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
    },
    stockBalance: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    stockReservation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    stockMovement: {
      create: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
    },
    stockAdjustment: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
    $queryRaw: jest.fn(),
  },
}));

describe('InventoryService (Unit)', () => {
  let service: InventoryService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    jest.clearAllMocks();
  });

  describe('createMaterial', () => {
    it('should create a material successfully', async () => {
      const mockMaterial = { id: 'mat-1', nama: 'Kain', satuan: 'meter', kategori: 'kain' };
      (prisma.material.create as jest.Mock).mockResolvedValue(mockMaterial);

      const result = await service.createMaterial({ nama: 'Kain', satuan: 'meter', kategori: 'kain' });

      expect(result).toEqual(mockMaterial);
      expect(prisma.material.create).toHaveBeenCalledWith({
        data: { nama: 'Kain', satuan: 'meter', kategori: 'kain' },
      });
    });
  });

  describe('findMaterials', () => {
    it('should return all materials sorted by name', async () => {
      const mockMaterials = [
        { id: 'mat-2', nama: 'Benang', satuan: 'cone', kategori: 'aksesoris' },
        { id: 'mat-1', nama: 'Kain', satuan: 'meter', kategori: 'kain' },
      ];
      (prisma.material.findMany as jest.Mock).mockResolvedValue(mockMaterials);

      const result = await service.findMaterials();

      expect(result).toEqual(mockMaterials);
      expect(prisma.material.findMany).toHaveBeenCalledWith({
        orderBy: { nama: 'asc' },
      });
    });
  });

  describe('createBom', () => {
    it('should throw NotFoundException if material does not exist', async () => {
      (prisma.material.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createBom({ productType: 'Kaos', materialId: 'nonexistent', qtyPerUnit: 2.3 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should upsert BOM successfully if material exists', async () => {
      const mockMaterial = { id: 'mat-1', nama: 'Kain' };
      const mockBom = { id: 'bom-1', productType: 'Kaos', materialId: 'mat-1', qtyPerUnit: 2.3 };

      (prisma.material.findUnique as jest.Mock).mockResolvedValue(mockMaterial);
      (prisma.billOfMaterial.upsert as jest.Mock).mockResolvedValue(mockBom);

      const result = await service.createBom({ productType: 'Kaos', materialId: 'mat-1', qtyPerUnit: 2.3 });

      expect(result).toEqual(mockBom);
      expect(prisma.billOfMaterial.upsert).toHaveBeenCalledWith({
        where: {
          productType_materialId: { productType: 'Kaos', materialId: 'mat-1' },
        },
        update: { qtyPerUnit: 2.3 },
        create: { productType: 'Kaos', materialId: 'mat-1', qtyPerUnit: 2.3 },
      });
    });
  });

  describe('getBom', () => {
    it('should throw NotFoundException if no BOM exists for product type', async () => {
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.getBom('Hoodie')).rejects.toThrow(NotFoundException);
    });

    it('should return BOM list if found', async () => {
      const mockBoms = [
        { id: 'bom-1', productType: 'Kaos', materialId: 'mat-1', qtyPerUnit: 2.3, material: { nama: 'Kain' } },
      ];
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue(mockBoms);

      const result = await service.getBom('Kaos');

      expect(result).toEqual(mockBoms);
      expect(prisma.billOfMaterial.findMany).toHaveBeenCalledWith({
        where: { productType: 'Kaos' },
        include: { material: true },
      });
    });
  });

  describe('reserveStock', () => {
    it('should throw NotFoundException if no default warehouse exists', async () => {
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.reserveStock({ orderId: 'order-1', materialId: 'mat-1', qty: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if stock is insufficient', async () => {
      const mockWarehouse = { id: 'wh-1', nama: 'Gudang Utama' };
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        materialId: 'mat-1',
        warehouseId: 'wh-1',
        qtyAvailable: 10,
        qtyReserved: 8,
      });

      // Mock row-lock output
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 10, qty_reserved: 8 },
      ]);

      await expect(
        service.reserveStock({ orderId: 'order-1', materialId: 'mat-1', qty: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reserve stock successfully when available stock is sufficient', async () => {
      const mockWarehouse = { id: 'wh-1', nama: 'Gudang Utama' };
      const mockReservation = {
        id: 'res-1',
        orderId: 'order-1',
        materialId: 'mat-1',
        qty: 5,
        status: 'ACTIVE',
        expiresAt: new Date(),
      };

      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        materialId: 'mat-1',
        warehouseId: 'wh-1',
        qtyAvailable: 100,
        qtyReserved: 10,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 100, qty_reserved: 10 },
      ]);
      (prisma.stockReservation.create as jest.Mock).mockResolvedValue(mockReservation);

      const result = await service.reserveStock({ orderId: 'order-1', materialId: 'mat-1', qty: 5 });

      expect(result).toEqual(mockReservation);
      expect(prisma.stockBalance.update).toHaveBeenCalledWith({
        where: {
          materialId_warehouseId: { materialId: 'mat-1', warehouseId: 'wh-1' },
        },
        data: { qtyReserved: 15 },
      });
      expect(eventEmitter.emit).toHaveBeenCalled();
    });
  });
});
