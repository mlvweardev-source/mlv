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

describe('Analytics — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const manajer = () => staffToken(seedData.manajer.id, UserRole.MANAJER_PRODUKSI);
  const penjahit = () => staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

  describe('GET /analytics/dashboard', () => {
    it('happy: Owner gets full dashboard with financial metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/dashboard')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      expect(res.body.period).toBeDefined();
      expect(res.body.orderCounts).toBeDefined();
      expect(res.body.conversionRate).toBeDefined();
      expect(res.body.topProducts).toBeDefined();
      expect(res.body.topCustomers).toBeDefined();
      expect(res.body.leadTime).toBeDefined();
      expect(res.body.stockAccuracy).toBeDefined();
      // Financial metrics (Owner-only)
      expect(res.body.omzet).toBeDefined();
      expect(res.body.profit).toBeDefined();
      expect(res.body.aov).toBeDefined();
    });

    it('happy: Manajer gets operational metrics only (no financial)', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/dashboard')
        .set('Authorization', `Bearer ${manajer()}`)
        .expect(200);

      expect(res.body.orderCounts).toBeDefined();
      expect(res.body.conversionRate).toBeDefined();
      // Financial metrics should NOT be present
      expect(res.body.omzet).toBeUndefined();
      expect(res.body.profit).toBeUndefined();
      expect(res.body.aov).toBeUndefined();
    });

    it('happy: custom date range', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/dashboard?from=2026-01-01&to=2026-12-31')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      expect(res.body.period.from).toBe('2026-01-01');
      expect(res.body.period.to).toBe('2026-12-31');
    });

    it('error: Penjahit cannot access dashboard', async () => {
      await request(app.getHttpServer())
        .get('/analytics/dashboard')
        .set('Authorization', `Bearer ${penjahit()}`)
        .expect(401);
    });

    it('error: Customer cannot access dashboard', async () => {
      await request(app.getHttpServer())
        .get('/analytics/dashboard')
        .set('Authorization', `Bearer ${customerToken(seedData.customer.id)}`)
        .expect(401);
    });
  });
});
