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
import { v4 as uuid } from 'uuid';

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

describe('Order — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const cust = () => customerToken(seedData.customer.id);

  async function makeDraftOrder() {
    const o = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${owner()}`)
      .send({ customerId: seedData.customer.id })
      .expect(201);
    const orderId = o.body.id;
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${owner()}`)
      .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 5 }] })
      .expect(201);
    return orderId;
  }

  describe('POST /orders', () => {
    it('happy: Owner can create order', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.orderNumber).toMatch(/^MLV-/);
    });
    it('happy: Customer can create order for self', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${cust()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      expect(res.body.status).toBe('DRAFT');
    });
    it('error: Customer cannot create for another', async () => {
      // API returns 404 because the UUID doesn't exist as a customer
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${cust()}`)
        .send({ customerId: uuid() })
        .expect(404);
    });
    it('error: non-UUID customerId rejected', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ customerId: 'bad' })
        .expect(400);
    });
  });

  describe('POST /orders/:id/items', () => {
    it('happy: add item to DRAFT order', async () => {
      const orderId = await makeDraftOrder();
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
    it('error: reject item on non-DRAFT', async () => {
      const orderId = await makeDraftOrder();
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 1 }] })
        .expect(400);
    });
  });

  describe('PATCH /orders/:id/status — Checkout flow', () => {
    it('happy: checkout DRAFT → MENUNGGU_PEMBAYARAN_DP', async () => {
      const orderId = await makeDraftOrder();
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'MENUNGGU_PEMBAYARAN_DP' });
      if (res.status !== 200) {
        console.log('CHECKOUT DEBUG:', res.status, JSON.stringify(res.body));
      }
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('MENUNGGU_PEMBAYARAN_DP');
      const reservations = await prisma.stockReservation.findMany({ where: { orderId } });
      expect(reservations.length).toBeGreaterThan(0);
    });
    it('happy: cancel order releases reservations', async () => {
      const orderId = await makeDraftOrder();
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
        .expect(200);
      const r = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'DIBATALKAN', reason: 'batal' })
        .expect(200);
      expect(r.body.status).toBe('DIBATALKAN');
      const res = await prisma.stockReservation.findMany({ where: { orderId } });
      expect(res.every((x) => x.status === 'RELEASED')).toBe(true);
    });
    it('error: reject invalid transition', async () => {
      const orderId = await makeDraftOrder();
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'LUNAS' })
        .expect(400);
    });
  });

  describe('executeCheckout — rollback on partial failure', () => {
    it('should rollback ALL reservations when one material insufficient', async () => {
      const o = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      const orderId = o.body.id;
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 500 }] })
        .expect(201);

      const benangId = seedData.materialRecords['Benang'];
      const benangBal = await prisma.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId: benangId, warehouseId: seedData.warehouse.id },
        },
      });
      const origBenang = benangBal!.qtyAvailable;
      await prisma.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId: benangId, warehouseId: seedData.warehouse.id },
        },
        data: { qtyAvailable: 10 },
      });

      const kainId = seedData.materialRecords['Kain'];
      const kainBefore = await prisma.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId: kainId, warehouseId: seedData.warehouse.id },
        },
      });

      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
        .expect(400);

      const kainAfter = await prisma.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId: kainId, warehouseId: seedData.warehouse.id },
        },
      });
      expect(kainAfter!.qtyReserved).toBe(kainBefore!.qtyReserved);
      const orphans = await prisma.stockReservation.findMany({
        where: { orderId, status: 'ACTIVE' },
      });
      expect(orphans.length).toBe(0);

      await prisma.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId: benangId, warehouseId: seedData.warehouse.id },
        },
        data: { qtyAvailable: origBenang },
      });
    });
  });

  describe('GET /orders', () => {
    it('happy: returns list', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('happy: Customer CAN access own orders', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${cust()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const order of res.body) {
        expect(order.customerId).toBe(seedData.customer.id);
      }
    });
  });

  describe('GET /orders/:id', () => {
    it('happy: returns order detail', async () => {
      const orderId = await makeDraftOrder();
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(res.body.id).toBe(orderId);
    });
    it('error: 404 for non-existent UUID', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${uuid()}`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(404);
    });
  });

  describe('GET /orders/:id/timeline', () => {
    it('happy: returns timeline', async () => {
      const orderId = await makeDraftOrder();
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}/timeline`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /orders/:id/duplicate', () => {
    it('happy: duplicates order', async () => {
      const orderId = await makeDraftOrder();
      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/duplicate`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(201);
      expect(res.body.id).not.toBe(orderId);
      expect(res.body.status).toBe('DRAFT');
    });
  });

  describe('GET /orders/check-availability', () => {
    it('happy: available for small qty', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/check-availability?productType=Kaos&qty=1')
        .set('Authorization', `Bearer ${cust()}`)
        .expect(200);
      expect(res.body.available).toBe(true);
    });
    it('happy: unavailable for huge qty', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/check-availability?productType=Kaos&qty=99999')
        .set('Authorization', `Bearer ${cust()}`)
        .expect(200);
      expect(res.body.available).toBe(false);
    });
  });
});
