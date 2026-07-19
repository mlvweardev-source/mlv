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

describe('Customer Chat — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const cust = () => customerToken(seedData.customer.id);

  // Helper: create a DRAFT order (chat works on any order status)
  async function createOrder() {
    const o = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${owner()}`)
      .send({ customerId: seedData.customer.id })
      .expect(201);
    return o.body.id;
  }

  // ==========================================
  // GET /orders/:id/customer-chat
  // ==========================================
  describe('GET /orders/:id/customer-chat', () => {
    it('happy: Owner can get thread', async () => {
      const orderId = await createOrder();
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.orderId).toBe(orderId);
      expect(Array.isArray(res.body.messages)).toBe(true);
    });

    it('happy: Customer can get own thread', async () => {
      const orderId = await createOrder();
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${cust()}`)
        .expect(200);

      expect(res.body.orderId).toBe(orderId);
    });

    it('error: Customer cannot access another customer order chat', async () => {
      const orderId = await createOrder();
      const otherCust = customerToken('nonexistent-customer-id');

      await request(app.getHttpServer())
        .get(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${otherCust}`)
        .expect(403);
    });

    it('error: Penjahit cannot access customer chat', async () => {
      const orderId = await createOrder();
      const penjahit = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      await request(app.getHttpServer())
        .get(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${penjahit}`)
        .expect(401);
    });
  });

  // ==========================================
  // POST /orders/:id/customer-chat
  // ==========================================
  describe('POST /orders/:id/customer-chat', () => {
    it('happy: Customer can send message', async () => {
      const orderId = await createOrder();

      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${cust()}`)
        .send({ pesan: 'Halo, pesanan saya bagaimana?' })
        .expect(201);

      expect(res.body.senderType).toBe('customer');
      expect(res.body.pesan).toBe('Halo, pesanan saya bagaimana?');
    });

    it('happy: Owner can send message', async () => {
      const orderId = await createOrder();

      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ pesan: 'Pesanan Anda sedang diproses' })
        .expect(201);

      expect(res.body.senderType).toBe('admin');
    });

    it('error: empty message rejected', async () => {
      const orderId = await createOrder();

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/customer-chat`)
        .set('Authorization', `Bearer ${cust()}`)
        .send({ pesan: '' })
        .expect(400);
    });
  });
});
