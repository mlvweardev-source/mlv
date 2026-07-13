import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env before importing prisma using Node's native process.loadEnvFile (supported in Node 20.6+)
if (typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile(path.resolve(__dirname, '../../../../../../.env'));
  } catch (e) {
    // Gracefully handle missing .env (e.g. in CI pipelines)
  }
} else {
  // Fallback in case of older node versions during test environments
  try {
    dotenv.config({ path: path.resolve(__dirname, '../../../../../../.env') });
  } catch (e) {
    // Gracefully handle missing package/file
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { prisma } from '@mlv/db';

describe('InventoryService (Concurrency Integration)', () => {
  let service: InventoryService;
  let testMaterialId: string;
  let defaultWarehouseId: string;
  let skipTests = false;

  beforeAll(async () => {
    if (process.env.SKIP_DB_INTEGRATION === 'true') {
      console.warn('⚠️ SKIP_DB_INTEGRATION=true detected. Skipping concurrency integration tests.');
      skipTests = true;
      return;
    }

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

    // 1. Dapatkan warehouse default (seeded)
    const warehouse = await prisma.warehouse.findFirst({
      where: { nama: 'Gudang Utama' },
    });
    if (!warehouse) {
      throw new Error('Gudang default tidak ditemukan, pastikan seed sudah berjalan.');
    }
    defaultWarehouseId = warehouse.id;

    // 2. Buat material khusus test
    const material = await prisma.material.create({
      data: {
        nama: 'Kain Concurrency Test',
        satuan: 'meter',
        kategori: 'kain',
      },
    });
    testMaterialId = material.id;
  });

  afterAll(async () => {
    if (skipTests) {
      try {
        await prisma.$disconnect();
      } catch (e) {
        // Disconnect errors can be safely ignored
      }
      return;
    }
    // Cleanup data test
    if (testMaterialId) {
      await prisma.stockReservation.deleteMany({
        where: { materialId: testMaterialId },
      });
      await prisma.stockMovement.deleteMany({
        where: { materialId: testMaterialId },
      });
      await prisma.stockBalance.deleteMany({
        where: { materialId: testMaterialId },
      });
      await prisma.billOfMaterial.deleteMany({
        where: { materialId: testMaterialId },
      });
      await prisma.material.delete({
        where: { id: testMaterialId },
      });
    }
    await prisma.$disconnect();
  });

  it('should prevent overselling and allow only one of the concurrent requests to succeed', async () => {
    if (skipTests) {
      console.log('Skipping test execution due to missing database connection.');
      return;
    }
    // 1. Setup stok awal: 10 unit tersedia, 0 ter-reserve
    await prisma.stockBalance.upsert({
      where: {
        materialId_warehouseId: {
          materialId: testMaterialId,
          warehouseId: defaultWarehouseId,
        },
      },
      update: {
        qtyAvailable: 10,
        qtyReserved: 0,
      },
      create: {
        materialId: testMaterialId,
        warehouseId: defaultWarehouseId,
        qtyAvailable: 10,
        qtyReserved: 0,
      },
    });

    // 2. Kirim dua request reserve stock secara bersamaan (concurrent)
    // Request A: minta 7 unit (butuh sisa 10 - 0 = 10, OK)
    // Request B: minta 6 unit (butuh sisa 10 - 0 = 10, OK jika sendiri, tapi total 13 > 10)
    const reservePromiseA = service.reserveStock({
      orderId: 'order-concurrency-A',
      materialId: testMaterialId,
      qty: 7,
    });

    const reservePromiseB = service.reserveStock({
      orderId: 'order-concurrency-B',
      materialId: testMaterialId,
      qty: 6,
    });

    const results = await Promise.allSettled([reservePromiseA, reservePromiseB]);

    // 3. Verifikasi hasil
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Harus tepat ada 1 yang berhasil dan 1 yang gagal
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Yang gagal harus melempar BadRequestException (stok tidak mencukupi)
    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('Stok tidak mencukupi');

    // 4. Verifikasi saldo akhir di DB
    const finalBalance = await prisma.stockBalance.findUnique({
      where: {
        materialId_warehouseId: {
          materialId: testMaterialId,
          warehouseId: defaultWarehouseId,
        },
      },
    });

    expect(finalBalance).toBeDefined();
    // Qty reserved harus berupa qty dari request yang berhasil (7 atau 6), bukan 13!
    const expectedReserved = (fulfilled[0] as PromiseFulfilledResult<any>).value.qty;
    expect(finalBalance!.qtyReserved).toBe(expectedReserved);
    expect(finalBalance!.qtyAvailable).toBe(10);
  });
});
