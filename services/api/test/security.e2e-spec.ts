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
import { signJwt } from '@mlv/auth';
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

describe('Security Tests — RBAC Bypass Attempts', () => {
  const owner = () => staffToken(seedData.owner.id, UserRole.OWNER);
  const manajer = () => staffToken(seedData.manajer.id, UserRole.MANAJER_PRODUKSI);
  const penjahit = () => staffToken(seedData.penjahit.id, UserRole.TIM_PENJAHIT);
  const cust = () => customerToken(seedData.customer.id);

  // ==========================================
  // A1. Token Tampering — edit payload, invalid signature
  // ==========================================
  describe('A1. Token tampering', () => {
    it('reject JWT with tampered role (PENJAHIT→OWNER, invalid signature)', async () => {
      // Create a valid penjahit token, then tamper with the payload
      const validToken = penjahit();
      const parts = validToken.split('.');
      // Decode payload, change role, re-encode WITHOUT valid signature
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.role = 'OWNER';
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.tampered-signature`;

      const res = await request(app.getHttpServer())
        .get('/profit-sharing')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);

      expect(res.body.message).toContain('Token tidak valid');
    });

    it('reject JWT with valid structure but wrong signing key', async () => {
      // Sign with a completely different secret
      const fakeToken = signJwt(
        { sub: seedData.owner.id, actorType: ActorType.USER, role: UserRole.OWNER },
        'wrong-secret-key-12345',
        '1h',
      );

      const res = await request(app.getHttpServer())
        .get('/profit-sharing')
        .set('Authorization', `Bearer ${fakeToken}`)
        .expect(401);

      expect(res.body.message).toContain('Token tidak valid');
    });

    it('reject completely fabricated JWT string', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.invalid')
        .expect(401);

      expect(res.body.message).toContain('Token tidak valid');
    });

    it('reject empty Bearer token', async () => {
      await request(app.getHttpServer()).get('/orders').set('Authorization', 'Bearer ').expect(401);
    });

    it('reject Authorization header without Bearer prefix', async () => {
      await request(app.getHttpServer()).get('/orders').set('Authorization', owner()).expect(401);
    });
  });

  // ==========================================
  // A2. Token Expired / Malformed
  // ==========================================
  describe('A2. Token expired and malformed', () => {
    it('reject expired JWT', async () => {
      const expiredToken = signJwt(
        { sub: seedData.owner.id, actorType: ActorType.USER, role: UserRole.OWNER },
        process.env.JWT_SECRET || 'test-secret-for-e2e',
        '-1h', // expired 1 hour ago
      );

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body.message).toContain('kadaluarsa');
    });

    it('reject request with no Authorization header', async () => {
      await request(app.getHttpServer()).get('/orders').expect(401);
    });

    it('reject random string as Bearer token', async () => {
      await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', 'Bearer not-a-jwt-at-all')
        .expect(401);
    });

    it('reject JWT with missing required fields (no sub)', async () => {
      const noSubToken = signJwt(
        { actorType: ActorType.USER, role: UserRole.OWNER } as any,
        process.env.JWT_SECRET || 'test-secret-for-e2e',
        '1h',
      );

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${noSubToken}`)
        .expect(401);

      expect(res.body.message).toContain('identitas');
    });
  });

  // ==========================================
  // A3. IDOR — Customer A tries to access Customer B's data
  // ==========================================
  describe('A3. IDOR (Insecure Direct Object Reference)', () => {
    let customerAOrderId: string;

    beforeAll(async () => {
      // Create an order for the seeded customer
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${owner()}`)
        .send({ customerId: seedData.customer.id })
        .expect(201);
      customerAOrderId = res.body.id;
    });

    it('customer B cannot access customer A order by ID', async () => {
      // Create a second customer token with a different ID
      const customerBToken = customerToken('00000000-0000-0000-0000-000000000001');

      const res = await request(app.getHttpServer())
        .get(`/orders/${customerAOrderId}`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('customer B cannot access customer A order list', async () => {
      const customerBToken = customerToken('00000000-0000-0000-0000-000000000001');

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(200);

      // Should only see own orders, not customer A's
      const orderIds = res.body.map((o: any) => o.id);
      expect(orderIds).not.toContain(customerAOrderId);
    });

    it('customer B cannot add items to customer A order', async () => {
      const customerBToken = customerToken('00000000-0000-0000-0000-000000000001');

      await request(app.getHttpServer())
        .post(`/orders/${customerAOrderId}/items`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 1 }] })
        .expect(403);
    });

    it('customer B cannot checkout customer A order', async () => {
      const customerBToken = customerToken('00000000-0000-0000-0000-000000000001');

      await request(app.getHttpServer())
        .patch(`/orders/${customerAOrderId}/status`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
        .expect(403);
    });
  });

  // ==========================================
  // A4. Horizontal Privilege Escalation — Penjahit A vs Penjahit B
  // ==========================================
  describe('A4. Horizontal privilege escalation', () => {
    it('penjahit cannot access another penjahit production tasks via direct ID', async () => {
      // The penjahit token is for seedData.penjahit.id
      // Try to access tasks — the service already filters by assignedTo
      const res = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${penjahit()}`)
        .expect(200);

      // All returned tasks should be assigned to this penjahit only
      for (const task of res.body) {
        if (task.assignedTo) {
          expect(task.assignedTo).toBe(seedData.penjahit.id);
        }
      }
    });

    it('penjahit cannot assign tasks (Owner/Manajer only)', async () => {
      // Get any task ID
      const tasksRes = await request(app.getHttpServer())
        .get('/production/tasks')
        .set('Authorization', `Bearer ${owner()}`)
        .expect(200);

      if (tasksRes.body.length > 0) {
        const taskId = tasksRes.body[0].id;
        await request(app.getHttpServer())
          .post(`/production/tasks/${taskId}/assign`)
          .set('Authorization', `Bearer ${penjahit()}`)
          .send({ assignedTo: seedData.penjahit.id })
          .expect(401);
      }
    });
  });

  // ==========================================
  // A5. Approval Workflow Bypass
  // ==========================================
  describe('A5. Approval workflow bypass', () => {
    let approvalId: string;

    beforeAll(async () => {
      // Create an approval as manajer
      const res = await request(app.getHttpServer())
        .post('/approvals')
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ tipe: 'DISKON', alasan: 'Security test' })
        .expect(201);
      approvalId = res.body.id;
    });

    it('manajer CANNOT decide own approval (Owner-only)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ status: 'APPROVED' })
        .expect(403);
    });

    it('penjahit CANNOT decide approval', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${penjahit()}`)
        .send({ status: 'APPROVED' })
        .expect(401);
    });

    it('customer CANNOT decide approval', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${cust()}`)
        .send({ status: 'APPROVED' })
        .expect(401);
    });

    it('approval status cannot be changed via PATCH body manipulation', async () => {
      // Try to change status directly (not via /decide endpoint)
      const res = await request(app.getHttpServer())
        .patch(`/approvals/${approvalId}`)
        .set('Authorization', `Bearer ${manajer()}`)
        .send({ status: 'APPROVED' });

      // Should be 404 (no such endpoint) or 401 — NOT 200
      expect([401, 404, 405]).toContain(res.status);
    });
  });
});

describe('Security Tests — Webhook Signature Tampering', () => {
  // ==========================================
  // B1. Webhook with wrong signature
  // ==========================================
  describe('B1. Webhook signature tampering', () => {
    it('reject webhook with completely wrong signature', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send({
          order_id: 'payment_fake-id',
          status_code: '200',
          gross_amount: '100000',
          transaction_id: 'txn-fake',
          transaction_status: 'settlement',
        })
        .set('x-midtrans-signature-key', 'completely-fake-signature-12345')
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('reject webhook with modified payload but original signature', async () => {
      // Create a real payment first
      const orderId = await createOrderReadyForDP();
      const payRes = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${staffToken(seedData.owner.id, UserRole.OWNER)}`)
        .send({ orderId, jenis: 'DP', metode: 'transfer', jumlah: 425000 })
        .expect(201);

      const paymentId = payRes.body.payment.id;
      const serverKey = getTestMidtransKey();
      const midtransOrderId = `payment_${paymentId}`;
      const statusCode = '200';
      const originalAmount = '425000';

      // Generate signature for ORIGINAL amount
      const sig = crypto
        .createHash('sha512')
        .update(`${midtransOrderId}${statusCode}${originalAmount}${serverKey}`)
        .digest('hex');

      // Send with MODIFIED amount but original signature
      const res = await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send({
          order_id: midtransOrderId,
          status_code: statusCode,
          gross_amount: '999999999', // tampered!
          transaction_id: `txn-tampered-${paymentId}`,
          transaction_status: 'settlement',
        })
        .set('x-midtrans-signature-key', sig)
        .expect(403);

      expect(res.body.message).toBeDefined();

      // Verify payment was NOT processed
      const paymentCheck = await request(app.getHttpServer())
        .get(`/payments/${paymentId}`)
        .set('Authorization', `Bearer ${staffToken(seedData.owner.id, UserRole.OWNER)}`)
        .expect(200);
      expect(paymentCheck.body.status).toBe('PENDING'); // should still be pending
    });

    it('reject webhook without signature header', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send({
          order_id: 'payment_fake',
          status_code: '200',
          gross_amount: '100000',
          transaction_id: 'txn-no-sig',
          transaction_status: 'settlement',
        })
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('reject webhook with empty signature header', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/webhook/midtrans')
        .send({
          order_id: 'payment_fake',
          status_code: '200',
          gross_amount: '100000',
          transaction_id: 'txn-empty-sig',
          transaction_status: 'settlement',
        })
        .set('x-midtrans-signature-key', '')
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('valid webhook with correct signature processes successfully', async () => {
      const orderId = await createOrderReadyForDP();
      const payRes = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${staffToken(seedData.owner.id, UserRole.OWNER)}`)
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
          transaction_id: `txn-valid-${paymentId}`,
          transaction_status: 'settlement',
        })
        .set('x-midtrans-signature-key', sig)
        .expect(200);
    });
  });
});

// ==========================================
// Helper function (same as finance.e2e-spec.ts)
// ==========================================
async function createOrderReadyForDP(): Promise<string> {
  const ownerToken = staffToken(seedData.owner.id, UserRole.OWNER);
  const o = await request(app.getHttpServer())
    .post('/orders')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ customerId: seedData.customer.id })
    .expect(201);
  const orderId = o.body.id;
  await request(app.getHttpServer())
    .post(`/orders/${orderId}/items`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ productType: 'Kaos', basePriceSnapshot: 85000, sizes: [{ ukuran: 'M', qty: 5 }] })
    .expect(201);
  await request(app.getHttpServer())
    .patch(`/orders/${orderId}/status`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ status: 'MENUNGGU_PEMBAYARAN_DP' })
    .expect(200);
  return orderId;
}
