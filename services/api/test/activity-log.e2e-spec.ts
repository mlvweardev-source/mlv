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

describe('Activity Log — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const manajer = () => staffToken(seedData.manajer.id, UserRole.MANAJER_PRODUKSI);
  const penjahit = () => staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

  // ==========================================
  // GET /activity-log
  // ==========================================
  describe('GET /activity-log', () => {
    it('happy: Owner can list activity logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/activity-log')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('happy: Manajer can list activity logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/activity-log')
        .set('Authorization', `Bearer ${manajer()}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('error: Penjahit cannot access system-wide activity log', async () => {
      await request(app.getHttpServer())
        .get('/activity-log')
        .set('Authorization', `Bearer ${penjahit()}`)
        .expect(401);
    });

    it('error: Customer cannot access activity log', async () => {
      await request(app.getHttpServer())
        .get('/activity-log')
        .set('Authorization', `Bearer ${customerToken(seedData.customer.id)}`)
        .expect(401);
    });
  });
});
