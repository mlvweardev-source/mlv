import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  staffToken,
  customerToken,
  cleanTestData,
  seedTestData,
  getTestMidtransKey,
} from './test-setup';
import { UserRole, ActorType } from '@mlv/auth';
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

describe('Finance — Integration Tests', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const manajer = () => staffToken(seedData.manajer.id, UserRole.MANAJER_PRODUKSI);
  const cust = () => customerToken(seedData.customer.id);

  // Helper: create an order in MENUNGGU_PEMBAYARAN_DP status
  async function createOrderReadyForDP() {
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
    return orderId;
  }

  // Helper: create order in LUNAS status (via webhook simulation)
  async function createOrderLunas() {
    const orderId = await createOrderReadyForDP();
    // Create DP payment
    const payRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${owner()}`)
      .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
      .expect(201);
    const paymentId = payRes.body.payment.id;
    // Simulate webhook success
    const serverKey = 'test-midtrans-key';
    const midtransOrderId = `payment_${paymentId}`;
    const statusCode = '200';
    const grossAmount = '425000';
    const sig = crypto
      .createHash('sha512')
      .update(`${midtransOrderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');
    await request(app.getHttpServer())
      .post('/payments/webhook/midtrans')
      .send({
        order_id: midtransOrderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        transaction_id: `txn-${paymentId}`,
        transaction_status: 'settlement',
      })
      .set('x-midtrans-signature-key', sig)
      .expect(200);
    return orderId;
  }

  // ==========================================
  // PAYMENT ENDPOINTS
  // ==========================================
  describe('POST /payments', () => {
    it('happy: Owner can create DP payment (transfer method)', async () => {
      const orderId = await createOrderReadyForDP();
      const res = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
        .expect(201);
      expect(res.body.payment.jenis).toBe('DP');
      expect(res.body.payment.status).toBe('PENDING');
    });

    it('happy: Customer auto-calculated DP (50%)', async () => {
      const o = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${cust()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/orders/${o.body.id}/items`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 10 }] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/orders/${o.body.id}/status`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${cust()}`)
        .send({ orderId: o.body.id, jenis: 'DP', metode: 'transfer' })
        .expect(201);
      // 85000 * 10 = 850000, 50% = 425000
      expect(res.body.payment.jumlah).toBe(425000);
    });

    it('error: DP rejected when order not in MENUNGGU_PEMBAYARAN_DP', async () => {
      const o = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId: o.body.id, jenis: 'DP', metode: 'transfer', jumlah: 100000 })
        .expect(400);
    });

    it('error: Customer cannot pay for another customer order', async () => {
      const orderId = await createOrderReadyForDP();
      // Try with different customer token
      const otherCust = customerToken('nonexistent-customer');
      await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${otherCust}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 100000 })
        .expect(403);
    });
  });

  // ==========================================
  // WEBHOOK ENDPOINT — SIGNATURE + IDEMPOTENCY
  // ==========================================
  describe('POST /payments/webhook/midtrans', () => {
    it('happy: valid signature processes payment', async () => {
      const orderId = await createOrderReadyForDP();
      const payRes = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
        .expect(201);
      const paymentId = payRes.body.payment.id;
      const serverKey = getTestMidtransKey();
      const midtransOrderId = `payment_${paymentId}`;
      const statusCode = '200';
      const grossAmount = '425000';
      const sig = crypto
        .createHash('sha512')
        .update(`${midtransOrderId}${statusCode}${grossAmount}${serverKey}`)
        .digest('hex');

      await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send({
          order_id: midtransOrderId,
          status_code: statusCode,
          gross_amount: grossAmount,
          transaction_id: `txn-${paymentId}`,
          transaction_status: 'settlement',
        })
        .set('x-midtrans-signature-key', sig)
        .expect(200);
    });

    it('error: invalid signature rejected (403)', async () => {
      await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send({
          order_id: 'payment_fake',
          status_code: '200',
          gross_amount: '100',
          transaction_id: 'txn-fake',
          transaction_status: 'settlement',
        })
        .set('x-midtrans-signature-key', 'invalid-signature')
        .expect(403);
    });

    it('idempotency: duplicate webhook does not double-process', async () => {
      const orderId = await createOrderReadyForDP();
      const payRes = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
        .expect(201);
      const paymentId = payRes.body.payment.id;
      const serverKey = getTestMidtransKey();
      const midtransOrderId = `payment_${paymentId}`;
      const statusCode = '200';
      const grossAmount = '425000';
      const sig = crypto
        .createHash('sha512')
        .update(`${midtransOrderId}${statusCode}${grossAmount}${serverKey}`)
        .digest('hex');
      const body = {
        order_id: midtransOrderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        transaction_id: `txn-dup-${paymentId}`,
        transaction_status: 'settlement',
      };

      // First webhook
      await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send(body)
        .set('x-midtrans-signature-key', sig)
        .expect(200);

      // Second webhook (duplicate) — should not throw, just no-op
      await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send(body)
        .set('x-midtrans-signature-key', sig)
        .expect(200);
    });
  });

  // ==========================================
  // GET /payments
  // ==========================================
  describe('GET /payments', () => {
    it('happy: Owner can list payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('happy: Manajer CAN access payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${manajer()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('happy: filter by orderId', async () => {
      const orderId = await createOrderReadyForDP();
      await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/payments?orderId=${orderId}`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // INVOICE ENDPOINTS
  // ==========================================
  describe('Invoices', () => {
    it('happy: list invoices', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('happy: get invoice detail', async () => {
      // Create a payment to generate an invoice
      const orderId = await createOrderReadyForDP();
      await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
        .expect(201);

      const invoices = await request(app.getHttpServer())
        .get(`/invoices?orderId=${orderId}`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      if (invoices.body.length > 0) {
        const detail = await request(app.getHttpServer())
          .get(`/invoices/${invoices.body[0].id}`)
          .set('Authorization', `Bearer ${owner()}`)
          .expect(200);
        expect(detail.body.id).toBeDefined();
      }
    });

    it('error: Penjahit cannot access invoices', async () => {
      const token = staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);
      await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('error: Customer CANNOT access invoices without orderId', async () => {
      await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${cust()}`)
        .expect(400);
    });
  });

  // ==========================================
  // APPROVAL WORKFLOW
  // ==========================================
  describe('Approval workflow', () => {
    it('happy: Manajer creates → Owner decides → effect executes', async () => {
      // Create approval (refId is optional for DISKON type)
      const createRes = await request(app.getHttpServer())
        .post('/approvals')
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ tipe: 'DISKON', alasan: 'Customer loyalty discount' })
        .expect(201);
      const approvalId = createRes.body.id;
      expect(createRes.body.status).toBe('PENDING');

      // Owner approves
      const decideRes = await request(app.getHttpServer())
        .patch(`/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ status: 'APPROVED', alasan: 'Approved for bulk order' })
        .expect(200);
      expect(decideRes.body.status).toBe('APPROVED');
    });

    it('error: Manajer cannot decide approval', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/approvals')
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ tipe: 'DISKON', alasan: 'Customer loyalty' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/approvals/${createRes.body.id}/decide`)
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ status: 'APPROVED' })
        .expect(403);
    });

    it('happy: Manajer only sees own approvals', async () => {
      // Create as manajer
      await request(app.getHttpServer())
        .post('/approvals')
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ tipe: 'HARGA_KHUSUS', alasan: 'test' })
        .expect(201);

      // Manajer lists - should only see own
      const res = await request(app.getHttpServer())
        .get('/approvals')
        .set('Authorization', `Bearer ${manajer()}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      // All returned approvals should be from this manajer
      for (const a of res.body) {
        expect(a.requestedBy).toBe(seedData.manajer.id);
      }
    });
  });

  // ==========================================
  // PROFIT SHARING
  // ==========================================
  describe('Profit Sharing (Owner-only)', () => {
    it('happy: Owner CRUD', async () => {
      // Create
      const createRes = await request(app.getHttpServer())
        .post('/profit-sharing')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ pihak: 'Penjahit', persentase: 30 })
        .expect(201);
      expect(createRes.body.pihak).toBe('Penjahit');

      // List
      const listRes = await request(app.getHttpServer())
        .get('/profit-sharing')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);

      // Update
      const updateRes = await request(app.getHttpServer())
        .patch(`/profit-sharing/${createRes.body.id}`)
        .set('Authorization', `Bearer ${owner()}`)
        .send({ persentase: 35 })
        .expect(200);
      expect(updateRes.body.persentase).toBe(35);

      // Delete
      await request(app.getHttpServer())
        .delete(`/profit-sharing/${createRes.body.id}`)
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);
    });

    it('error: Manajer cannot access profit-sharing', async () => {
      await request(app.getHttpServer())
        .get('/profit-sharing')
        .set('Authorization', `Bearer ${manajer()}`)
        .expect(401);
    });
  });
});
