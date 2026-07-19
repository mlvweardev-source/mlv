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
import { v4 as uuid } from 'uuid';
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

describe('Identity & Access — Integration Tests', () => {
  // ==========================================
  // POST /auth/login
  // ==========================================
  describe('POST /auth/login', () => {
    it('happy: should login with valid credentials and set cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@mlv.dev', password: 'owner123' })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('owner@mlv.dev');
      expect(res.body.user.role).toBe('OWNER');
      // Cookies should be set
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.includes('mlv_access_token'))).toBe(true);
      expect(cookies.some((c: string) => c.includes('mlv_refresh_token'))).toBe(true);
    });

    it('error: should reject invalid password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@mlv.dev', password: 'wrongpassword' })
        .expect(401);

      expect(res.body.message).toContain('Email atau password salah');
    });

    it('error: should reject non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@mlv.dev', password: 'owner123' })
        .expect(401);
    });

    it('error: should reject missing fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@mlv.dev' })
        .expect(400);
    });
  });

  // ==========================================
  // GET /auth/me
  // ==========================================
  describe('GET /auth/me', () => {
    it('happy: should return user info for authenticated staff', async () => {
      const token = staffToken(seedData.owner.id, UserRole.OWNER, 'owner@mlv.dev');

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.email).toBe('owner@mlv.dev');
      expect(res.body.role).toBe('OWNER');
    });

    it('happy: should return customer info for authenticated customer', async () => {
      const token = customerToken(seedData.customer.id);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.nama).toBe('Budi Pelanggan');
    });

    it('error: should reject unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('error: should reject invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  // ==========================================
  // GET /auth/users
  // ==========================================
  describe('GET /auth/users', () => {
    it('happy: should return staff users for Owner', async () => {
      const token = staffToken(seedData.owner.id, UserRole.OWNER);

      const res = await request(app.getHttpServer())
        .get('/auth/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });

    it('happy: should filter by role', async () => {
      const token = staffToken(seedData.owner.id, UserRole.OWNER);

      const res = await request(app.getHttpServer())
        .get('/auth/users?role=TIM_PENJAHIT')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.every((u: any) => u.role === 'TIM_PENJAHIT')).toBe(true);
    });

    it('error: should reject customer access', async () => {
      const token = customerToken(seedData.customer.id);

      await request(app.getHttpServer())
        .get('/auth/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('error: should reject Penjahit access', async () => {
      const token = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      await request(app.getHttpServer())
        .get('/auth/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  // ==========================================
  // RBAC general
  // ==========================================
  describe('RBAC enforcement', () => {
    it('error: should reject Penjahit from accessing Owner-only endpoints', async () => {
      const token = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      await request(app.getHttpServer())
        .get('/profit-sharing')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('error: should reject staff from customer-only endpoints (no AllowCustomer)', async () => {
      const token = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

      // Reviews endpoint: @AllowCustomer() allows customer actorType, but staff gets 403
      await request(app.getHttpServer())
        .post(`/customers/${seedData.customer.id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: uuid(), rating: 5, komentar: 'test' })
        .expect(403);
    });

    it('happy: should allow cookie-based auth', async () => {
      const token = staffToken(seedData.owner.id, UserRole.OWNER, 'owner@mlv.dev');

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`mlv_access_token=${token}`])
        .expect(200);

      expect(res.body.email).toBe('owner@mlv.dev');
    });
  });
});
