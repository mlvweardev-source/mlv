import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, staffToken, cleanTestData, seedTestData } from './test-setup';
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

describe('Shipping — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);

  // Helper: create order and set to LUNAS via direct DB manipulation
  async function createLunasOrder() {
    const o = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${owner()}`)
      .send({ customerId: seedData.customer.id })
      .expect(201);
    const orderId = o.body.id;

    // Add item
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${owner()}`)
      .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 5 }] })
      .expect(201);

    // Directly set order to LUNAS (bypass checkout/payment for shipping tests)
    await prisma.order.update({ where: { id: orderId }, data: { status: 'LUNAS' } });
    return orderId;
  }

  // ==========================================
  // POST /shipments
  // ==========================================
  describe('POST /shipments', () => {
    it('happy: Owner can create shipment for LUNAS order', async () => {
      const orderId = await createLunasOrder();
      const res = await request(app.getHttpServer())
        .post('/shipments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, kurir: 'JNE', noResi: 'RESI123' })
        .expect(201);
      expect(res.body.kurir).toBe('JNE');
      expect(res.body.trackingToken).toBeDefined();
    });

    it('error: cannot create shipment for non-LUNAS order', async () => {
      const o = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      await request(app.getHttpServer())
        .post('/shipments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId: o.body.id, kurir: 'JNE' })
        .expect(400);
    });
  });

  // ==========================================
  // GET /shipments
  // ==========================================
  describe('GET /shipments', () => {
    it('happy: list shipments', async () => {
      const res = await request(app.getHttpServer())
        .get('/shipments')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ==========================================
  // GET /shipments/:token/track (public)
  // ==========================================
  describe('GET /shipments/:token/track', () => {
    it('happy: public tracking with valid token', async () => {
      const orderId = await createLunasOrder();
      const shipRes = await request(app.getHttpServer())
        .post('/shipments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, kurir: 'JNE', noResi: 'TRACK001' })
        .expect(201);
      const token = shipRes.body.trackingToken;

      const trackRes = await request(app.getHttpServer())
        .get(`/shipments/${token}/track`)
        .expect(200);
      expect(trackRes.body.kurir).toBe('JNE');
    });

    it('error: invalid token returns 404', async () => {
      await request(app.getHttpServer())
        .get('/shipments/00000000-0000-0000-0000-000000000000/track')
        .expect(404);
    });
  });

  // ==========================================
  // PATCH /shipments/:id
  // ==========================================
  describe('PATCH /shipments/:id', () => {
    it('happy: update shipment status', async () => {
      const orderId = await createLunasOrder();
      const shipRes = await request(app.getHttpServer())
        .post('/shipments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, kurir: 'JNE', noResi: 'UPD001' })
        .expect(201);

      const updRes = await request(app.getHttpServer())
        .patch(`/shipments/${shipRes.body.id}`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'DIKIRIM' })
        .expect(200);
      expect(updRes.body.status).toBe('DIKIRIM');
    });
  });
});
