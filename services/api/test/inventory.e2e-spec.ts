import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  staffToken,
  customerToken,
  cleanTestData,
  seedTestData,
} from './test-setup';
import { UserRole } from '@mlv/auth';
import { prisma } from '@mlv/db';

let app: INestApplication;
let seedData: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  app = await createTestApp();
  await cleanTestData();
  seedData = await seedTestData();
});

afterAll(async () => {
  await cleanTestData();
  await app.close();
});

describe('Inventory — Integration Tests', () => {
  const ownerToken = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const penjahitToken = () => staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

  describe('GET /materials', () => {
    it('happy: should return all materials', async () => {
      const res = await request(app.getHttpServer())
        .get('/materials')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(8);
    });

    it('happy: Penjahit CAN access materials list', async () => {
      const res = await request(app.getHttpServer())
        .get('/materials')
        .set('Authorization', `Bearer ${penjahitToken()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('error: Customer CANNOT access staff-only materials', async () => {
      const token = customerToken(seedData.customer.id);
      await request(app.getHttpServer())
        .get('/materials')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('error: Unauthenticated cannot access', async () => {
      await request(app.getHttpServer()).get('/materials').expect(401);
    });
  });

  describe('POST /materials', () => {
    it('happy: Owner can create material', async () => {
      const res = await request(app.getHttpServer())
        .post('/materials')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .send({ nama: 'Test Material E2E', satuan: 'pcs', kategori: 'test' })
        .expect(201);

      expect(res.body.nama).toBe('Test Material E2E');
    });
  });

  describe('GET /bom', () => {
    it('happy: should return BOM for Kaos', async () => {
      const res = await request(app.getHttpServer())
        .get('/bom/Kaos')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('error: should return 404 for unknown product type', async () => {
      await request(app.getHttpServer())
        .get('/bom/UnknownProduct')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(404);
    });
  });

  describe('GET /stock/balance', () => {
    it('happy: should return stock balances', async () => {
      const res = await request(app.getHttpServer())
        .get('/stock/balance')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('POST /stock/reserve + POST /stock/release', () => {
    it('happy: reserve then release lifecycle', async () => {
      const matId = seedData.materialRecords['Kain'];

      const reserveRes = await request(app.getHttpServer())
        .post('/stock/reserve')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .send({ orderId: 'e2e-lifecycle-1', materialId: matId, qty: 5 })
        .expect(201);

      expect(reserveRes.body.status).toBe('ACTIVE');

      const releaseRes = await request(app.getHttpServer())
        .post('/stock/release')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .send({ reservationId: reserveRes.body.id })
        .expect(201);

      expect(releaseRes.body.status).toBe('RELEASED');
    });

    it('error: should reject when insufficient stock', async () => {
      const matId = seedData.materialRecords['Kain'];
      await request(app.getHttpServer())
        .post('/stock/reserve')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .send({ orderId: 'e2e-fail-reserve', materialId: matId, qty: 99999 })
        .expect(400);
    });
  });

  describe('POST /purchases + PATCH /purchases/:id/complete', () => {
    it('happy: create PO then complete', async () => {
      const matId = seedData.materialRecords['Label'];

      const poRes = await request(app.getHttpServer())
        .post('/purchases')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .send({
          supplier: 'E2E Supplier',
          materialId: matId,
          qty: 100,
          totalBiaya: 300000,
          tglBeli: '2026-07-19',
        })
        .expect(201);

      expect(poRes.body.status).toBe('PENDING');

      const completeRes = await request(app.getHttpServer())
        .patch(`/purchases/${poRes.body.id}/complete`)
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(200);

      expect(completeRes.body.status).toBe('COMPLETED');
    });
  });

  describe('Row-locking: concurrent stock reservation', () => {
    it('should prevent overselling with concurrent requests', async () => {
      const matId = seedData.materialRecords['Kain'];

      // Set stock to exactly 15
      await prisma.stockReservation.deleteMany({ where: { materialId: matId } });
      await prisma.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId: matId, warehouseId: seedData.warehouse.id },
        },
        data: { qtyAvailable: 15, qtyReserved: 0 },
      });

      const token = ownerToken();

      // 3 concurrent requests: each wants 10 (total demand=30, supply=15)
      const results = await Promise.allSettled([
        request(app.getHttpServer())
          .post('/stock/reserve')
          .set('Authorization', `Bearer ${token}`)
          .send({ orderId: 'concurrent-0', materialId: matId, qty: 10 }),
        request(app.getHttpServer())
          .post('/stock/reserve')
          .set('Authorization', `Bearer ${token}`)
          .send({ orderId: 'concurrent-1', materialId: matId, qty: 10 }),
        request(app.getHttpServer())
          .post('/stock/reserve')
          .set('Authorization', `Bearer ${token}`)
          .send({ orderId: 'concurrent-2', materialId: matId, qty: 10 }),
      ]);

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as any).status === 201,
      );
      const failures = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as any).status === 400,
      );

      // At most 1 succeeds (15/10=1 with 5 remaining), at least 2 fail
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);

      // Verify no overselling
      const finalBalance = await prisma.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId: matId, warehouseId: seedData.warehouse.id },
        },
      });
      expect(finalBalance!.qtyReserved).toBe(10);
      expect(finalBalance!.qtyAvailable).toBe(15); // unchanged by reservation

      // Cleanup
      await prisma.stockReservation.deleteMany({ where: { materialId: matId } });
      await prisma.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId: matId, warehouseId: seedData.warehouse.id },
        },
        data: { qtyReserved: 0, qtyAvailable: 1000 },
      });
    });
  });
});
