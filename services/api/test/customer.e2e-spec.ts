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

describe('Customer — Integration Tests', () => {
  const ownerToken = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const custToken = () => customerToken(seedData.customer.id);

  describe('GET /customers/:id', () => {
    it('happy: Owner can get any customer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/customers/${seedData.customer.id}`)
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(200);

      expect(res.body.nama).toBe('Budi Pelanggan');
    });

    it('happy: Customer can get own profile', async () => {
      const res = await request(app.getHttpServer())
        .get(`/customers/${seedData.customer.id}`)
        .set('Authorization', `Bearer ${custToken()}`)
        .expect(200);

      expect(res.body.nama).toBe('Budi Pelanggan');
    });

    it('error: Customer cannot get another customer', async () => {
      await request(app.getHttpServer())
        .get(`/customers/${seedData.owner.id}`)
        .set('Authorization', `Bearer ${custToken()}`)
        .expect(403);
    });

    it('error: Non-existent customer returns 404', async () => {
      await request(app.getHttpServer())
        .get('/customers/nonexistent-id')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .expect(404);
    });
  });

  describe('PATCH /customers/:id', () => {
    it('happy: Customer can update own profile', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/customers/${seedData.customer.id}`)
        .set('Authorization', `Bearer ${custToken()}`)
        .send({ nama: 'Budi Updated' })
        .expect(200);

      expect(res.body.nama).toBe('Budi Updated');

      // Reset
      await request(app.getHttpServer())
        .patch(`/customers/${seedData.customer.id}`)
        .set('Authorization', `Bearer ${custToken()}`)
        .send({ nama: 'Budi Pelanggan' });
    });

    it('error: Customer cannot update another customer', async () => {
      await request(app.getHttpServer())
        .patch(`/customers/${seedData.owner.id}`)
        .set('Authorization', `Bearer ${custToken()}`)
        .send({ nama: 'Hacker' })
        .expect(403);
    });
  });

  describe('GET /customers/:id/orders', () => {
    it('happy: should return orders for customer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/customers/${seedData.customer.id}/orders`)
        .set('Authorization', `Bearer ${custToken()}`)
        .expect(200);

      expect(res.body.orders).toBeDefined();
      expect(Array.isArray(res.body.orders)).toBe(true);
    });

    it('error: Customer cannot see another customer orders', async () => {
      await request(app.getHttpServer())
        .get(`/customers/${seedData.owner.id}/orders`)
        .set('Authorization', `Bearer ${custToken()}`)
        .expect(403);
    });
  });
});
