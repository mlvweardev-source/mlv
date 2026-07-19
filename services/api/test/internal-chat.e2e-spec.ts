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

describe('Internal Chat — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const manajer = () => staffToken(seedData.manajer.id, UserRole.MANAJER_PRODUKSI);
  const penjahit = () => staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

  async function createOrder() {
    const o = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${owner()}`)
      .send({ customerId: seedData.customer.id })
      .expect(201);
    return o.body.id;
  }

  // ==========================================
  // GET /orders/:id/internal-chat
  // ==========================================
  describe('GET /orders/:id/internal-chat', () => {
    it('happy: Owner can get thread', async () => {
      const orderId = await createOrder();
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}/internal-chat`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(Array.isArray(res.body.messages)).toBe(true);
    });

    it('error: Penjahit without assigned tasks gets 403', async () => {
      const orderId = await createOrder();
      // Penjahit passes guard (class-level @Roles includes TIM_PENJAHIT)
      // but service validates if penjahit has assigned tasks → 403 if none
      await request(app.getHttpServer())
        .get(`/orders/${orderId}/internal-chat`)
        .set('Authorization', `Bearer ${penjahit()}`)
        .expect(403);
    });

    it('error: Customer cannot access internal chat', async () => {
      const orderId = await createOrder();
      const cust = customerToken(seedData.customer.id);

      await request(app.getHttpServer())
        .get(`/orders/${orderId}/internal-chat`)
        .set('Authorization', `Bearer ${cust}`)
        .expect(401);
    });
  });

  // ==========================================
  // POST /orders/:id/internal-chat
  // ==========================================
  describe('POST /orders/:id/internal-chat', () => {
    it('happy: Owner can send message', async () => {
      const orderId = await createOrder();

      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/internal-chat`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ pesan: 'Order ini perlu dipercepat' })
        .expect(201);

      expect(res.body.senderId).toBe(seedData.owner.id);
      expect(res.body.pesan).toBe('Order ini perlu dipercepat');
    });

    it('happy: Manajer can send message', async () => {
      const orderId = await createOrder();

      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/internal-chat`)
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ pesan: 'Saya assign task ke Penjahit 1' })
        .expect(201);

      expect(res.body.senderId).toBe(seedData.manajer.id);
    });

    it('error: empty message rejected', async () => {
      const orderId = await createOrder();

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/internal-chat`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ pesan: '' })
        .expect(400);
    });
  });
});
