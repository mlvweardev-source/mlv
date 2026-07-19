import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createNotificationTestApp, staffToken } from './test-setup';
import { UserRole } from '@mlv/auth';
import { prisma } from '@mlv/db';

let app: INestApplication;

beforeAll(async () => {
  app = await createNotificationTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('Notification — Integration Tests', () => {
  const owner = () => staffToken('owner-test-id', UserRole.OWNER);
  const manajer = () => staffToken('manajer-test-id', UserRole.MANAJER_PRODUKSI);
  const penjahit = () => staffToken('penjahit-test-id', UserRole.TIM_PENJAHIT);

  // ==========================================
  // GET /notifications
  // ==========================================
  describe('GET /notifications', () => {
    it('happy: Owner can list notifications', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      expect(res.body.total).toBeDefined();
      expect(Array.isArray(res.body.notifications)).toBe(true);
    });

    it('happy: Manajer can list notifications', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${manajer()}`)
        .expect(200);

      expect(res.body.total).toBeDefined();
    });

    it('happy: Penjahit can list (filtered to own)', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${penjahit()}`)
        .expect(200);

      expect(res.body.total).toBeDefined();
    });

    it('error: unauthenticated rejected', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });
  });

  // ==========================================
  // POST /notifications/dispatch
  // ==========================================
  describe('POST /notifications/dispatch', () => {
    it('happy: Owner can dispatch notification (no template = no-op)', async () => {
      const res = await request(app.getHttpServer())
        .post('/notifications/dispatch')
        .set('Authorization', `Bearer ${owner()}`)
        .send({
          eventType: 'test.nonexistent.event',
          payload: { test: true },
        })
        .expect(201);

      expect(res.body.templatesFound).toBe(0);
      expect(res.body.sent).toBe(0);
    });

    it('error: Penjahit cannot dispatch', async () => {
      await request(app.getHttpServer())
        .post('/notifications/dispatch')
        .set('Authorization', `Bearer ${penjahit()}`)
        .send({
          eventType: 'test.event',
          payload: {},
        })
        .expect(401);
    });
  });
});
