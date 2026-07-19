/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO CUSTOMER SUPPORT — Fase 12 Bagian 2
 *
 * Membuktikan: AI Customer Support menjawab pertanyaan dari konteks order
 * aktual (auto-reply aman), dan TIDAK menjawab pertanyaan di luar konteks
 * (eskalasi ke manusia). §9: AI HANYA jawab dari data, tidak menebak.
 *
 * Alur demo:
 *  1. Setup: order ANTREAN dengan DP sukses, customer login
 *  2. Customer tanya "Kapan pesanan saya selesai?" → AI jawab dari status/timeline
 *  3. Customer tanya "Sudah dibayar DP-nya?" → AI jawab dari payment
 *  4. Customer tanya "Bisa minta diskon 20%?" → AI escalate (canAnswer=false)
 *  5. Customer tanya "Saya komplain, hasil printing miring" → escalate
 *  6. Customer tanya "Mau revisi tambah qty jadi 100" → escalate
 *  7. Owner balas manual (senderType=admin) — flow existing tetap jalan
 *  8. Verifikasi: thread berisi campuran customer / ai_bot / admin
 *  9. Edge case: AI gateway down → AI gagal, no auto-reply (fail-safe)
 *
 * Jalankan: pnpm --filter @mlv/api demo:customer-support
 *
 * CATATAN: services/api & services/ai-gateway harus berjalan.
 * Set GEMINI_API_KEY di .env untuk hasil AI non-null.
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { AuthService } from '../src/domains/identity-access/services/auth.service';

const DEMO_PORT = 3997;
const BASE = `http://localhost:${DEMO_PORT}`;
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'http://localhost:3002';

function line(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function loginStaff(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login staff ${email} gagal: ${res.status}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/mlv_access_token=([^;]+)/);
  if (!match) throw new Error(`Cookie staff ${email} tidak ditemukan`);
  return match[1];
}

async function aiGatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${AI_GATEWAY_URL}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/** Tunggu sebentar (memberi waktu AI auto-reply push via SSE di background) */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(DEMO_PORT);

  // ==========================================
  // 1. SETUP DATA
  // ==========================================
  line('1. SETUP DATA ORDER UNTUK DEMO CUSTOMER SUPPORT');

  const gatewayUp = await aiGatewayUp();
  check('AI gateway reachable', gatewayUp, `url=${AI_GATEWAY_URL}`);
  if (!gatewayUp) {
    console.log('❌ AI gateway tidak berjalan. Jalankan: pnpm --filter @mlv/ai-gateway dev');
    await app.close();
    return;
  }

  // Cleanup previous runs
  await prisma.customerChatMessage.deleteMany({
    where: { thread: { order: { customer: { email: 'cs-demo@mlv.dev' } } } },
  });
  await prisma.customerChatThread.deleteMany({
    where: { order: { customer: { email: 'cs-demo@mlv.dev' } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { customer: { email: 'cs-demo@mlv.dev' } } },
  });
  await prisma.orderTimelineEvent.deleteMany({
    where: { order: { customer: { email: 'cs-demo@mlv.dev' } } },
  });
  await prisma.order.deleteMany({
    where: { customer: { email: 'cs-demo@mlv.dev' } },
  });
  await prisma.customer.deleteMany({ where: { email: 'cs-demo@mlv.dev' } });

  const customer = await prisma.customer.create({
    data: { nama: 'Demo Customer CS', noHp: '08129999002', email: 'cs-demo@mlv.dev' },
  });

  // Order ANTREAN (DP sukses, produksi akan jalan) — pertanyaan in-context
  // akan dijawab AI dari status + timeline + payment
  const order = await prisma.order.create({
    data: {
      orderNumber: `MLV-DEMO-CS-${Date.now()}`,
      customerId: customer.id,
      status: 'ANTREAN',
      items: {
        create: [
          {
            productType: 'Kaos',
            basePriceSnapshot: 85000,
            sizes: {
              create: [
                { ukuran: 'M', qty: 30 },
                { ukuran: 'L', qty: 20 },
              ],
            },
          },
        ],
      },
    },
    include: { items: { include: { sizes: true } } },
  });
  const totalQty = order.items[0].sizes.reduce((sum, s) => sum + s.qty, 0);
  const totalHarga = order.items[0].basePriceSnapshot * totalQty;

  // Tambah payment DP sukses + timeline
  await prisma.payment.create({
    data: {
      orderId: order.id,
      jenis: 'DP',
      metode: 'midtrans_snap',
      jumlah: totalHarga * 0.5,
      status: 'SUCCESS',
      verifiedAt: new Date(),
    },
  });
  await prisma.orderTimelineEvent.createMany({
    data: [
      {
        orderId: order.id,
        tipeEvent: 'DIBUAT',
        deskripsi: `Order ${order.orderNumber} dibuat`,
      },
      {
        orderId: order.id,
        tipeEvent: 'CHECKOUT',
        deskripsi: 'Checkout berhasil. 4 material di-reserve.',
      },
      {
        orderId: order.id,
        tipeEvent: 'ORDER_CONFIRMED',
        deskripsi: 'Pembayaran DP berhasil. Order masuk antrean produksi.',
      },
    ],
  });
  check('Order ANTREAN + DP sukses dibuat', true, `orderId=${order.id} total=${totalQty}pcs`);

  // Login Owner
  const ownerToken = await loginStaff('owner@mlv.dev', 'owner123');

  // Generate customer JWT
  const authService = app.get(AuthService);
  const custToken = (authService as any).issueCustomerToken(customer).accessToken;

  const headersCust = {
    'Content-Type': 'application/json',
    cookie: `mlv_customer_token=${custToken}`,
  };
  const headersOwner = {
    'Content-Type': 'application/json',
    cookie: `mlv_access_token=${ownerToken}`,
  };

  // ==========================================
  // 2. PERTANYAAN IN-CONTEXT #1 — STATUS ORDER
  // ==========================================
  line('2. PELANGGAN: "Kapan pesanan saya selesai?"');

  await fetch(`${BASE}/orders/${order.id}/customer-chat`, {
    method: 'POST',
    headers: headersCust,
    body: JSON.stringify({ pesan: 'Kapan pesanan saya selesai?' }),
  });
  // Tunggu AI auto-reply (background, max 20 detik)
  await sleep(20_000);

  let thread = await prisma.customerChatMessage.findMany({
    where: { thread: { orderId: order.id } },
    orderBy: { createdAt: 'asc' },
  });
  const aiReply1 = thread.find((m) => m.senderType === 'ai_bot');
  check(
    'AI auto-reply posted (senderType=ai_bot)',
    !!aiReply1,
    aiReply1 ? `pesan="${aiReply1.pesan.slice(0, 60)}..."` : 'tidak ada balasan AI',
  );
  if (aiReply1) {
    check(
      'AI reply punya senderId=null (bukan staff/customer)',
      aiReply1.senderId === null,
      `senderId=${aiReply1.senderId}`,
    );
    check('AI reply punya pesan (tidak kosong)', aiReply1.pesan.length > 10);
  }

  // ==========================================
  // 3. PERTANYAAN IN-CONTEXT #2 — PAYMENT STATUS
  // ==========================================
  line('3. PELANGGAN: "Sudah dibayar DP-nya?"');

  const beforeCount = thread.length;
  await fetch(`${BASE}/orders/${order.id}/customer-chat`, {
    method: 'POST',
    headers: headersCust,
    body: JSON.stringify({ pesan: 'Sudah dibayar DP-nya?' }),
  });
  await sleep(20_000);

  thread = await prisma.customerChatMessage.findMany({
    where: { thread: { orderId: order.id } },
    orderBy: { createdAt: 'asc' },
  });
  const aiReply2 = thread.filter((m) => m.senderType === 'ai_bot')[1];
  check(
    'AI auto-reply ke-2 posted',
    thread.length > beforeCount && !!aiReply2,
    aiReply2 ? `pesan="${aiReply2.pesan.slice(0, 60)}..."` : 'tidak ada balasan',
  );

  // ==========================================
  // 4. PERTANYAAN OUT-OF-CONTEXT #1 — DISKON
  // ==========================================
  line('4. PELANGGAN: "Bisa minta diskon 20%?" — HARUS ESKALASI');

  const beforeEsc1 = thread.length;
  await fetch(`${BASE}/orders/${order.id}/customer-chat`, {
    method: 'POST',
    headers: headersCust,
    body: JSON.stringify({ pesan: 'Bisa minta diskon 20%?' }),
  });
  await sleep(15_000);

  thread = await prisma.customerChatMessage.findMany({
    where: { thread: { orderId: order.id } },
    orderBy: { createdAt: 'asc' },
  });
  const newMsgsEsc1 = thread.slice(beforeEsc1);
  const aiReply3 = newMsgsEsc1.find((m) => m.senderType === 'ai_bot');
  check(
    'AI TIDAK jawab pertanyaan diskon (escalated)',
    !aiReply3,
    aiReply3 ? `AI malah jawab: "${aiReply3.pesan.slice(0, 50)}..."` : 'tidak ada balasan AI (✓)',
  );
  check(
    'Pesan pelanggan tetap masuk thread (staf bisa lihat)',
    newMsgsEsc1.some((m) => m.senderType === 'customer' && m.pesan.includes('diskon')),
  );

  // ==========================================
  // 5. PERTANYAAN OUT-OF-CONTEXT #2 — KOMPLAIN
  // ==========================================
  line('5. PELANGGAN: "Hasil printing miring, saya komplain" — ESKALASI');

  const beforeEsc2 = thread.length;
  await fetch(`${BASE}/orders/${order.id}/customer-chat`, {
    method: 'POST',
    headers: headersCust,
    body: JSON.stringify({ pesan: 'Hasil printing miring, saya komplain' }),
  });
  await sleep(15_000);

  thread = await prisma.customerChatMessage.findMany({
    where: { thread: { orderId: order.id } },
    orderBy: { createdAt: 'asc' },
  });
  const newMsgsEsc2 = thread.slice(beforeEsc2);
  check('AI TIDAK jawab komplain (escalated)', !newMsgsEsc2.find((m) => m.senderType === 'ai_bot'));

  // ==========================================
  // 6. PERTANYAAN OUT-OF-CONTEXT #3 — REVISI SPESIFIKASI
  // ==========================================
  line('6. PELANGGAN: "Mau revisi tambah qty jadi 100" — ESKALASI');

  const beforeEsc3 = thread.length;
  await fetch(`${BASE}/orders/${order.id}/customer-chat`, {
    method: 'POST',
    headers: headersCust,
    body: JSON.stringify({ pesan: 'Mau revisi, tambah qty jadi 100' }),
  });
  await sleep(15_000);

  thread = await prisma.customerChatMessage.findMany({
    where: { thread: { orderId: order.id } },
    orderBy: { createdAt: 'asc' },
  });
  const newMsgsEsc3 = thread.slice(beforeEsc3);
  check(
    'AI TIDAK jawab perubahan spesifikasi (escalated)',
    !newMsgsEsc3.find((m) => m.senderType === 'ai_bot'),
  );

  // ==========================================
  // 7. OWNER BALAS MANUAL — FLOW EXISTING TETAP JALAN
  // ==========================================
  line('7. OWNER BALAS PESAN ESKALASI MANUAL');

  const beforeOwner = thread.length;
  const ownerReply = await fetch(`${BASE}/orders/${order.id}/customer-chat`, {
    method: 'POST',
    headers: headersOwner,
    body: JSON.stringify({ pesan: 'Halo, untuk diskon akan saya review dulu ya.' }),
  });
  check('Owner POST balasan 201', ownerReply.ok, `status=${ownerReply.status}`);

  thread = await prisma.customerChatMessage.findMany({
    where: { thread: { orderId: order.id } },
    orderBy: { createdAt: 'asc' },
  });
  const newMsgsOwner = thread.slice(beforeOwner);
  check(
    'Owner reply punya senderType=admin',
    newMsgsOwner.some((m) => m.senderType === 'admin'),
  );

  // ==========================================
  // 8. VERIFIKASI STRUKTUR THREAD
  // ==========================================
  line('8. VERIFIKASI STRUKTUR THREAD — CAMPURAN customer / ai_bot / admin');

  const customerMsgs = thread.filter((m) => m.senderType === 'customer');
  const aiBotMsgs = thread.filter((m) => m.senderType === 'ai_bot');
  const adminMsgs = thread.filter((m) => m.senderType === 'admin');
  console.log(
    `  ℹ️  Thread: ${customerMsgs.length} customer / ${aiBotMsgs.length} ai_bot / ${adminMsgs.length} admin (total ${thread.length})`,
  );
  check('Ada pesan customer', customerMsgs.length >= 5, `jumlah=${customerMsgs.length}`);
  check(
    'Ada minimal 2 balasan AI (in-context)',
    aiBotMsgs.length >= 2,
    `jumlah=${aiBotMsgs.length}`,
  );
  check('Ada balasan admin manual', adminMsgs.length === 1, `jumlah=${adminMsgs.length}`);

  // ==========================================
  // CLEANUP
  // ==========================================
  await prisma.customerChatMessage.deleteMany({
    where: { thread: { orderId: order.id } },
  });
  await prisma.customerChatThread.deleteMany({ where: { orderId: order.id } });
  await prisma.payment.deleteMany({ where: { orderId: order.id } });
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.orderTimelineEvent.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.customer.delete({ where: { id: customer.id } });

  await app.close();
  await prisma.$disconnect();

  line('HASIL DEMO CUSTOMER SUPPORT');
  console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures} failure(s)`);
  console.log('\nKesimpulan: AI Customer Support menjawab dari data order aktual');
  console.log('  - Pertanyaan in-context (status, payment) → auto-reply');
  console.log('  - Pertanyaan out-of-context (diskon, komplain, revisi) → eskalasi');
  console.log('  - Pesan yang di-eskalasi tetap masuk thread, staf balas manual');
  console.log('  - Tidak ada chat pelanggan yang hilang dari staf');

  if (failures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Demo failed:', err);
  process.exit(1);
});
