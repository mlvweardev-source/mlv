import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, staffToken, cleanTestData, seedTestData } from './test-setup';
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

describe('AI Assistant — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);

  // ==========================================
  // POST /ai-assistant/quotation
  // ==========================================
  describe('POST /ai-assistant/quotation', () => {
    it('error: Penjahit cannot access (RBAC)', async () => {
      const penjahit = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      await request(app.getHttpServer())
        .post('/ai-assistant/quotation')
        .set('Authorization', `Bearer ${penjahit}`)
        .send({ productType: 'Kaos', qty: 100 })
        .expect(401);
    });

    it('error: Customer cannot access', async () => {
      const { customerToken } = await import('./test-setup');
      await request(app.getHttpServer())
        .post('/ai-assistant/quotation')
        .set('Authorization', `Bearer ${customerToken(seedData.customer.id)}`)
        .send({ productType: 'Kaos', qty: 100 })
        .expect(401);
    });
  });

  // ==========================================
  // POST /ai-assistant/production-assistant
  // ==========================================
  describe('POST /ai-assistant/production-assistant', () => {
    it('error: Penjahit cannot access (RBAC)', async () => {
      const penjahit = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      await request(app.getHttpServer())
        .post('/ai-assistant/production-assistant')
        .set('Authorization', `Bearer ${penjahit}`)
        .send({ orderId: 'some-order-id' })
        .expect(401);
    });
  });

  // ==========================================
  // POST /ai-assistant/inventory-prediction
  // ==========================================
  describe('POST /ai-assistant/inventory-prediction', () => {
    it('error: Penjahit cannot access (RBAC)', async () => {
      const penjahit = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      await request(app.getHttpServer())
        .post('/ai-assistant/inventory-prediction')
        .set('Authorization', `Bearer ${penjahit}`)
        .expect(401);
    });
  });

  // ==========================================
  // POST /ai-assistant/customer-support
  // ==========================================
  describe('POST /ai-assistant/customer-support', () => {
    it('happy: Penjahit can access (AllowCustomer allows any auth user)', async () => {
      const penjahit = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      // @AllowCustomer() allows any authenticated user (staff or customer)
      const res = await request(app.getHttpServer())
        .post('/ai-assistant/customer-support')
        .set('Authorization', `Bearer ${penjahit}`)
        .send({ pertanyaan: 'Kapan pesanan saya selesai?', orderContext: {} })
        .expect(201);

      // Response may have null hasil if AI gateway is unavailable (fail-safe)
      expect(res.body).toBeDefined();
    });
  });
});
