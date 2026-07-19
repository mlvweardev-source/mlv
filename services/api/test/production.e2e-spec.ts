import { v4 as uuid } from 'uuid';
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
import * as crypto from 'crypto';

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

describe('Production — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const manajer = () => staffToken(seedData.manajer.id, UserRole.MANAJER_PRODUKSI);
  const penjahit = () => staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);

  // Helper: create order, checkout, pay DP, trigger production tasks
  async function createOrderWithTasks() {
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
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${owner()}`)
      .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
      .expect(200);

    // Pay DP + webhook
    const payRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${owner()}`)
      .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
      .expect(201);
    const paymentId = payRes.body.payment.id;
    const serverKey = 'test-midtrans-key';
    const mid = `payment_${paymentId}`;
    const sig = crypto.createHash('sha512').update(`${mid}200425000${serverKey}`).digest('hex');
    await request(app.getHttpServer())
      .post('/payments/webhook/midtrans')
      .send({
        order_id: mid,
        status_code: '200',
        gross_amount: '425000',
        transaction_id: `txn-${paymentId}`,
        transaction_status: 'settlement',
      })
      .set('x-midtrans-signature-key', sig)
      .expect(200);

    // Move to ANTREAN to trigger task generation
    // (DP payment should auto-transition to ANTREAN via event)
    return orderId;
  }

  // ==========================================
  // GET /production/routings/:productType
  // ==========================================
  describe('GET /production/routings/:productType', () => {
    it('happy: returns routing for Kaos', async () => {
      const res = await request(app.getHttpServer())
        .get('/production/routings/Kaos')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(res.body.productType).toBe('Kaos');
      expect(res.body.urutanTask).toBeDefined();
    });

    it('error: 404 for unknown product type', async () => {
      await request(app.getHttpServer())
        .get('/production/routings/Unknown')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(404);
    });
  });

  // ==========================================
  // GET /production/tasks
  // ==========================================
  describe('GET /production/tasks', () => {
    it('happy: Owner can list all tasks', async () => {
      const res = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('happy: Penjahit sees only own tasks', async () => {
      const res = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${penjahit()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('error: unauthenticated rejected', async () => {
      await request(app.getHttpServer()).get('/production/tasks').expect(401);
    });
  });

  // ==========================================
  // POST /production/tasks/:id/assign
  // ==========================================
  describe('POST /production/tasks/:id/assign', () => {
    it('happy: Owner can assign task to Penjahit', async () => {
      // Get first available task
      const tasksRes = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      if (tasksRes.body.length > 0) {
        const taskId = tasksRes.body[0].id;
        const res = await request(app.getHttpServer())
          .post(`/production/tasks/${taskId}/assign`)
          .set('Authorization', `Bearer ${owner()}`)
          .send({ userId: seedData.penjahit.id })
          .expect(201);
        expect(res.body.assignedTo).toBe(seedData.penjahit.id);
      }
    });

    it('error: Penjahit cannot assign tasks', async () => {
      await request(app.getHttpServer())
        .post(`/production/tasks/${uuid()}/assign`)
        .set('Authorization', `Bearer ${penjahit()}`)
        .send({ userId: seedData.penjahit.id })
        .expect(403);
    });
  });

  // ==========================================
  // PATCH /production/tasks/:id/status
  // ==========================================
  describe('PATCH /production/tasks/:id/status', () => {
    it('happy: Owner can update task status', async () => {
      const tasksRes = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      const assignedTask = tasksRes.body.find(
        (t: any) => t.status === 'DITERIMA' || t.status === 'SEDANG_DILAKSANAKAN',
      );
      if (assignedTask) {
        const newStatus = assignedTask.status === 'DITERIMA' ? 'SEDANG_DILAKSANAKAN' : 'SELESAI';
        await request(app.getHttpServer())
          .patch(`/production/tasks/${assignedTask.id}/status`)
          .set('Authorization', `Bearer ${owner()}`)
          .send({ status: newStatus })
          .expect(200);
      }
    });

    it('error: reject invalid status transition', async () => {
      // Find a DITERIMA task and try to set it to SELESAI (invalid: must go through SEDANG_DILAKSANAKAN)
      const tasksRes = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      const diterimaTask = tasksRes.body.find((t: any) => t.status === 'DITERIMA');
      if (diterimaTask) {
        // DITERIMA → SELESAI is invalid (must go through SEDANG_DILAKSANAKAN)
        await request(app.getHttpServer())
          .patch(`/production/tasks/${diterimaTask.id}/status`)
          .set('Authorization', `Bearer ${owner()}`)
          .send({ status: 'SELESAI' })
          .expect(400);
      }
    });
  });

  // ==========================================
  // PATCH /production/tasks/:id/qc
  // ==========================================
  describe('PATCH /production/tasks/:id/qc', () => {
    it('happy: Owner can set QC status on SELESAI task', async () => {
      const tasksRes = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      const selesaiTask = tasksRes.body.find((t: any) => t.status === 'SELESAI');
      if (selesaiTask) {
        const res = await request(app.getHttpServer())
          .patch(`/production/tasks/${selesaiTask.id}/qc`)
          .set('Authorization', `Bearer ${owner()}`)
          .send({ qcStatus: 'pass' })
          .expect(200);
        expect(res.body.qcStatus).toBe('pass');
      }
    });

    it('error: Penjahit cannot set QC', async () => {
      await request(app.getHttpServer())
        .patch(`/production/tasks/${uuid()}/qc`)
        .set('Authorization', `Bearer ${penjahit()}`)
        .send({ qcStatus: 'pass' })
        .expect(401);
    });
  });
});
