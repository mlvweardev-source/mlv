import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
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
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    stockAdjustment: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
    $queryRaw: jest.fn(),
  },
}));

describe('InventoryService (Unit)', () => {
  let service: InventoryService;
  let mockEventBus: { publish: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: EventBusService,
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    mockEventBus = module.get(EventBusService);
    jest.clearAllMocks();
  });

  describe('createMaterial', () => {
    it('should create a material successfully', async () => {
      const mockMaterial = { id: 'mat-1', nama: 'Kain', satuan: 'meter', kategori: 'kain' };
      (prisma.material.create as jest.Mock).mockResolvedValue(mockMaterial);

      const result = await service.createMaterial({
        nama: 'Kain',
        satuan: 'meter',
        kategori: 'kain',
      });

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

      const result = await service.createBom({
        productType: 'Kaos',
        materialId: 'mat-1',
        qtyPerUnit: 2.3,
      });

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
        {
          id: 'bom-1',
          productType: 'Kaos',
          materialId: 'mat-1',
          qtyPerUnit: 2.3,
          material: { nama: 'Kain' },
        },
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

      const result = await service.reserveStock({
        orderId: 'order-1',
        materialId: 'mat-1',
        qty: 5,
      });

      expect(result).toEqual(mockReservation);
      expect(prisma.stockBalance.update).toHaveBeenCalledWith({
        where: {
          materialId_warehouseId: { materialId: 'mat-1', warehouseId: 'wh-1' },
        },
        data: { qtyReserved: 15 },
      });
      expect(mockEventBus.publish).toHaveBeenCalled();
    });
  });

  // ==========================================
  // Purchase Order — Fase 9 Bagian 2
  // "Tandai diterima" WAJIB punya efek stok nyata, bukan flip status saja.
  // ==========================================

  describe('completePurchaseOrder', () => {
    const mockPo = {
      id: 'po-1',
      supplier: 'Toko Kain Jaya',
      materialId: 'mat-1',
      qty: 50,
      totalBiaya: 1500000,
      status: 'PENDING',
    };
    const mockWarehouse = { id: 'wh-1', nama: 'Gudang Utama' };

    it('should throw NotFoundException if purchase order does not exist', async () => {
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.completePurchaseOrder('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if PO is already COMPLETED (idempotent guard)', async () => {
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockPo,
        status: 'COMPLETED',
      });
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);
      // Compare-and-swap gagal: tidak ada row PENDING yang ter-update
      (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.completePurchaseOrder('po-1')).rejects.toThrow(BadRequestException);
      // Stok TIDAK boleh tersentuh
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.stockBalance.update).not.toHaveBeenCalled();
    });

    it('should create stock movement IN and increase stock balance in one transaction', async () => {
      (prisma.purchaseOrder.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPo) // pre-check di luar transaksi
        .mockResolvedValueOnce({ ...mockPo, status: 'COMPLETED', material: { nama: 'Kain' } });
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);
      (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue({
        materialId: 'mat-1',
        warehouseId: 'wh-1',
        qtyAvailable: 100,
        qtyReserved: 0,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 100, qty_reserved: 0 },
      ]);

      const result = await service.completePurchaseOrder('po-1', 'user-manajer');

      // Compare-and-swap PENDING → COMPLETED
      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'po-1', status: 'PENDING' },
        data: { status: 'COMPLETED' },
      });
      // Movement IN tercatat (sumber kebenaran)
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          materialId: 'mat-1',
          warehouseId: 'wh-1',
          tipe: 'IN',
          qty: 50,
          refType: 'purchase_order',
          refId: 'po-1',
          createdBy: 'user-manajer',
        },
      });
      // Balance cache bertambah 100 → 150
      expect(prisma.stockBalance.update).toHaveBeenCalledWith({
        where: {
          materialId_warehouseId: { materialId: 'mat-1', warehouseId: 'wh-1' },
        },
        data: { qtyAvailable: 150 },
      });
      expect(result?.status).toBe('COMPLETED');
    });

    it('should initialize stock balance if material has no balance record yet', async () => {
      (prisma.purchaseOrder.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPo)
        .mockResolvedValueOnce({ ...mockPo, status: 'COMPLETED', material: { nama: 'Kain' } });
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);
      (prisma.purchaseOrder.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.stockBalance.findUnique as jest.Mock).mockResolvedValue(null); // belum ada balance
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { material_id: 'mat-1', warehouse_id: 'wh-1', qty_available: 0, qty_reserved: 0 },
      ]);

      await service.completePurchaseOrder('po-1');

      expect(prisma.stockBalance.create).toHaveBeenCalledWith({
        data: { materialId: 'mat-1', warehouseId: 'wh-1', qtyAvailable: 0, qtyReserved: 0 },
      });
      expect(prisma.stockBalance.update).toHaveBeenCalledWith({
        where: {
          materialId_warehouseId: { materialId: 'mat-1', warehouseId: 'wh-1' },
        },
        data: { qtyAvailable: 50 },
      });
    });
  });

  describe('findPurchaseOrders', () => {
    it('should return purchase orders with material, newest first', async () => {
      const mockPos = [{ id: 'po-2' }, { id: 'po-1' }];
      (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue(mockPos);

      const result = await service.findPurchaseOrders();

      expect(result).toEqual(mockPos);
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith({
        include: { material: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findStockAdjustments', () => {
    it('should return adjustments with material, newest first', async () => {
      const mockAdjustments = [{ id: 'adj-1' }];
      (prisma.stockAdjustment.findMany as jest.Mock).mockResolvedValue(mockAdjustments);

      const result = await service.findStockAdjustments();

      expect(result).toEqual(mockAdjustments);
      expect(prisma.stockAdjustment.findMany).toHaveBeenCalledWith({
        include: { material: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findAllBoms', () => {
    it('should return all BOM rows with material', async () => {
      const mockBoms = [{ id: 'bom-1', productType: 'Kaos' }];
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue(mockBoms);

      const result = await service.findAllBoms();

      expect(result).toEqual(mockBoms);
      expect(prisma.billOfMaterial.findMany).toHaveBeenCalledWith({
        include: { material: true },
        orderBy: [{ productType: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('checkAvailability', () => {
    it('should return available true if there is enough stock for all BOM items', async () => {
      const mockWarehouse = { id: 'wh-1', nama: 'Gudang Utama' };
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);

      const mockBom = [
        { materialId: 'mat-1', qtyPerUnit: 2.0, material: { nama: 'Kain' } },
        { materialId: 'mat-2', qtyPerUnit: 1.0, material: { nama: 'Label' } },
      ];
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue(mockBom);

      // Enough stock
      (prisma.stockBalance.findUnique as jest.Mock).mockImplementation(({ where }) => {
        const matId = where.materialId_warehouseId.materialId;
        if (matId === 'mat-1') {
          return Promise.resolve({ qtyAvailable: 100, qtyReserved: 10 }); // free: 90. needed: 2 * 10 = 20
        }
        if (matId === 'mat-2') {
          return Promise.resolve({ qtyAvailable: 50, qtyReserved: 5 });  // free: 45. needed: 1 * 10 = 10
        }
        return Promise.resolve(null);
      });

      const result = await service.checkAvailability('Kaos', 10);

      expect(result).toEqual({
        available: true,
        estimation: 'Bahan baku tersedia',
      });
    });

    it('should return available false if any BOM item has insufficient stock', async () => {
      const mockWarehouse = { id: 'wh-1', nama: 'Gudang Utama' };
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(mockWarehouse);

      const mockBom = [
        { materialId: 'mat-1', qtyPerUnit: 2.0, material: { nama: 'Kain' } },
        { materialId: 'mat-2', qtyPerUnit: 1.0, material: { nama: 'Label' } },
      ];
      (prisma.billOfMaterial.findMany as jest.Mock).mockResolvedValue(mockBom);

      // Insufficient stock for mat-1
      (prisma.stockBalance.findUnique as jest.Mock).mockImplementation(({ where }) => {
        const matId = where.materialId_warehouseId.materialId;
        if (matId === 'mat-1') {
          return Promise.resolve({ qtyAvailable: 15, qtyReserved: 0 }); // free: 15. needed: 20 -> insufficient!
        }
        if (matId === 'mat-2') {
          return Promise.resolve({ qtyAvailable: 50, qtyReserved: 5 });
        }
        return Promise.resolve(null);
      });

      const result = await service.checkAvailability('Kaos', 10);

      expect(result.available).toBe(false);
      expect(result.estimation).toContain('Bahan tidak mencukupi: Kain');
    });
  });
});
