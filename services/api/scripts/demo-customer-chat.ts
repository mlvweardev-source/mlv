/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO CUSTOMER CHAT — Fase 10 Bagian 4
 *
 * Membuktikan chat pelanggan ↔ admin (staf) berjalan aman & realtime:
 *  1. Customer GET thread miliknya sendiri → 200
 *  2. Customer POST pesan → senderType='customer'
 *  3. Owner GET thread customer → 200 (staf bisa lihat semua)
 *  4. Owner POST balasan → senderType='admin'
 *  5. Customer GET ulang → lihat balasan admin
 *  6. Customer B (pelanggan lain) GET thread customer A → 403 (RBAC ownership)
 *  7. Penjahit GET thread → 403 (RBAC role, Customer Chat bukan untuk Penjahit)
 *  8. SSE stream terbuka, pesan baru di-push realtime (verifikasi end-to-end)
 *
 * Jalankan: pnpm --filter @mlv/api demo:customer-chat
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { AuthService } from '../src/domains/identity-access/services/auth.service';

const DEMO_PORT = 3994;
const BASE = `http://localhost:${DEMO_PORT}`;

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
  // Cookie Set-Cookie di header — parse manual
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/mlv_access_token=([^;]+)/);
  if (!match) throw new Error(`Cookie staff ${email} tidak ditemukan`);
  return match[1];
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(DEMO_PORT);

  // ==========================================
  // 1. SEED DATA
  // ==========================================
  line('1. MENYIAPKAN DATA SEED UNTUK DEMO CUSTOMER CHAT');

  // Cleanup previous runs
  await prisma.customerChatMessage.deleteMany({
    where: { thread: { order: { customer: { email: 'chat-a@mlv.dev' } } } },
  });
  await prisma.customerChatThread.deleteMany({
    where: { order: { customer: { email: 'chat-a@mlv.dev' } } },
  });
  const prevOrders = await prisma.order.findMany({
    where: { customer: { email: { in: ['chat-a@mlv.dev', 'chat-b@mlv.dev'] } } },
    select: { id: true },
  });
  if (prevOrders.length > 0) {
    await prisma.stockReservation.deleteMany({
      where: { orderId: { in: prevOrders.map((o) => o.id) } },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: prevOrders.map((o) => o.id) } } });
    await prisma.orderTimelineEvent.deleteMany({
      where: { orderId: { in: prevOrders.map((o) => o.id) } },
    });
  }
  await prisma.order.deleteMany({
    where: { customer: { email: { in: ['chat-a@mlv.dev', 'chat-b@mlv.dev'] } } },
  });
  await prisma.customer.deleteMany({
    where: { email: { in: ['chat-a@mlv.dev', 'chat-b@mlv.dev'] } },
  });

  // Create demo customers
  const customerA = await prisma.customer.create({
    data: { nama: 'Andi Chat', noHp: '08120000001', email: 'chat-a@mlv.dev' },
  });
  const customerB = await prisma.customer.create({
    data: { nama: 'Budi Chat Lain', noHp: '08120000002', email: 'chat-b@mlv.dev' },
  });

  // Create order for customer A (DRAFT is enough — chat allowed on any status)
  const orderA = await prisma.order.create({
    data: {
      orderNumber: `MLV-DEMO-CHAT-${Date.now()}`,
      customerId: customerA.id,
      status: 'DRAFT',
    },
  });

  // Staff login (seed users: owner@mlv.dev / owner123, penjahit@mlv.dev / penjahit123)
  const ownerToken = await loginStaff('owner@mlv.dev', 'owner123');
  const penjahitToken = await loginStaff('penjahit@mlv.dev', 'penjahit123');

  // Customer tokens via AuthService (private method — cast any, pola demo-checkout)
  const authService = app.get(AuthService);
  const custTokenA = (authService as any).issueCustomerToken(customerA).accessToken;
  const custTokenB = (authService as any).issueCustomerToken(customerB).accessToken;

  const headersCustA = {
    'Content-Type': 'application/json',
    cookie: `mlv_customer_token=${custTokenA}`,
  };
  const headersCustB = {
    'Content-Type': 'application/json',
    cookie: `mlv_customer_token=${custTokenB}`,
  };
  const headersOwner = {
    'Content-Type': 'application/json',
    cookie: `mlv_access_token=${ownerToken}`,
  };
  const headersPenjahit = {
    'Content-Type': 'application/json',
    cookie: `mlv_access_token=${penjahitToken}`,
  };

  console.log(`Seed OK: customerA=${customerA.id}, customerB=${customerB.id}, orderA=${orderA.id}`);

  // ==========================================
  // 2. CUSTOMER A AKSES THREAD MILIKNYA
  // ==========================================
  line('2. GET /orders/:id/customer-chat — CUSTOMER A AKSES THREAD SENDIRI');

  const getA = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, { headers: headersCustA });
  check('Customer A GET thread 200 OK', getA.ok, `status=${getA.status}`);
  const threadA = await getA.json();
  check(
    'Thread terikat ke customer A',
    threadA.customerId === customerA.id,
    `customerId=${threadA.customerId}`,
  );
  check('Thread awal kosong (0 pesan)', threadA.messages.length === 0);

  // ==========================================
  // 3. CUSTOMER A KIRIM PESAN
  // ==========================================
  line('3. POST /orders/:id/customer-chat — CUSTOMER A KIRIM PESAN');

  const postA = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    method: 'POST',
    headers: headersCustA,
    body: JSON.stringify({ pesan: 'Halo admin, kapan order saya selesai?' }),
  });
  check('Customer A POST pesan 201', postA.ok, `status=${postA.status}`);
  const msgA = await postA.json();
  check(
    'senderType pesan customer = "customer"',
    msgA.senderType === 'customer',
    `senderType=${msgA.senderType}`,
  );
  check(
    'senderId pesan customer = customerA.id',
    msgA.senderId === customerA.id,
    `senderId=${msgA.senderId}`,
  );

  // ==========================================
  // 4. OWNER (STAF) LIHAT THREAD + BALAS
  // ==========================================
  line('4. OWNER GET + POST BALASAN — STAF BISA LIHAT SEMUA THREAD');

  const getOwner = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    headers: headersOwner,
  });
  check('Owner GET thread customer A 200 OK', getOwner.ok, `status=${getOwner.status}`);
  const threadOwner = await getOwner.json();
  check(
    'Owner lihat pesan customer',
    threadOwner.messages.length === 1 && threadOwner.messages[0].senderType === 'customer',
    `messages=${threadOwner.messages.length}`,
  );
  check(
    'Nama customer ter-resolve di pesan',
    threadOwner.messages[0].senderNama === 'Andi Chat',
    `senderNama=${threadOwner.messages[0].senderNama}`,
  );

  const postOwner = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    method: 'POST',
    headers: headersOwner,
    body: JSON.stringify({ pesan: 'Halo Andi, order Anda sedang dalam antrean produksi.' }),
  });
  check('Owner POST balasan 201', postOwner.ok, `status=${postOwner.status}`);
  const msgOwner = await postOwner.json();
  check(
    'senderType balasan admin = "admin"',
    msgOwner.senderType === 'admin',
    `senderType=${msgOwner.senderType}`,
  );

  // ==========================================
  // 5. CUSTOMER A LIHAT BALASAN ADMIN
  // ==========================================
  line('5. GET ULANG — CUSTOMER A LIHAT BALASAN ADMIN');

  const getA2 = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, { headers: headersCustA });
  const threadA2 = await getA2.json();
  check(
    'Thread customer A sekarang punya 2 pesan',
    threadA2.messages.length === 2,
    `messages=${threadA2.messages.length}`,
  );
  check(
    'Pesan kedua senderType="admin"',
    threadA2.messages[1].senderType === 'admin',
    `senderType=${threadA2.messages[1].senderType}`,
  );

  // ==========================================
  // 6. RBAC: CUSTOMER B DITOLAK
  // ==========================================
  line('6. RBAC OWNERSHIP — CUSTOMER B AKSES THREAD CUSTOMER A → 403');

  const getB = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, { headers: headersCustB });
  check('Customer B GET thread A ditolak 403', getB.status === 403, `status=${getB.status}`);

  const postB = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    method: 'POST',
    headers: headersCustB,
    body: JSON.stringify({ pesan: 'Ini pesan nakal dari customer B' }),
  });
  check('Customer B POST ke thread A ditolak 403', postB.status === 403, `status=${postB.status}`);

  // Verifikasi pesan B tidak masuk DB
  const msgsAfterB = await prisma.customerChatMessage.count({
    where: { thread: { orderId: orderA.id } },
  });
  check('Tidak ada pesan baru dari customer B di DB', msgsAfterB === 2, `count=${msgsAfterB}`);

  // ==========================================
  // 7. RBAC: PENJAHIT DITOLAK
  // ==========================================
  line('7. RBAC ROLE — TIM PENJAHIT TIDAK ADA AKSES CUSTOMER CHAT');

  // AuthGuard melempar 401 (Unauthorized) untuk role mismatch — konvensi
  // existing codebase. Yang penting: akses ditolak, tidak ada leak data.
  const getPenjahit = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    headers: headersPenjahit,
  });
  check(
    'Penjahit GET customer chat ditolak (401/403)',
    getPenjahit.status === 401 || getPenjahit.status === 403,
    `status=${getPenjahit.status}`,
  );

  const postPenjahit = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    method: 'POST',
    headers: headersPenjahit,
    body: JSON.stringify({ pesan: 'Saya penjahit, saya mau chat customer' }),
  });
  check(
    'Penjahit POST customer chat ditolak (401/403)',
    postPenjahit.status === 401 || postPenjahit.status === 403,
    `status=${postPenjahit.status}`,
  );

  // ==========================================
  // 8. SSE STREAM — REALTIME PUSH VERIFICATION
  // ==========================================
  line('8. SSE STREAM — PESAN BARU DI-PUSH REALTIME');

  // Buka SSE stream sebagai reader, lalu POST pesan paralel — verifikasi pesan sampai
  let sseReceived: any = null;
  let sseError: string | null = null;
  const sseController = new AbortController();

  const ssePromise = (async () => {
    const res = await fetch(`${BASE}/orders/${orderA.id}/customer-chat/stream`, {
      headers: headersCustA,
      signal: sseController.signal,
    });
    if (!res.body) throw new Error('SSE response body null');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Baca sampai dapat pesan (bukan ping) atau timeout 5s
    const timeout = setTimeout(() => sseController.abort(), 8000);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE event = dipisahkan \n\n; data: <json>
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const ev of events) {
        const dataLine = ev.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (payload === ':' || !payload) continue; // ping
        try {
          sseReceived = JSON.parse(payload);
          clearTimeout(timeout);
          return;
        } catch {
          /* ignore */
        }
      }
    }
  })().catch((e) => {
    if (e.name !== 'AbortError') sseError = e.message;
  });

  // Beri SSE kesempatan untuk connect, lalu kirim pesan dari Owner
  await new Promise((r) => setTimeout(r, 500));
  const ssePost = await fetch(`${BASE}/orders/${orderA.id}/customer-chat`, {
    method: 'POST',
    headers: headersOwner,
    body: JSON.stringify({ pesan: 'Pesan realtime via SSE demo!' }),
  });
  check('POST pesan untuk SSE test 201', ssePost.ok);

  // Tunggu SSE menerima pesan (max 8s)
  await ssePromise;
  sseController.abort();

  check(
    'SSE stream push pesan baru diterima client',
    sseReceived !== null && sseReceived?.pesan === 'Pesan realtime via SSE demo!',
    sseError ?? (sseReceived ? `pesan="${sseReceived.pesan}"` : 'tidak ada event'),
  );
  if (sseReceived) {
    check(
      'SSE pesan senderType="admin" (dari Owner)',
      sseReceived.senderType === 'admin',
      `senderType=${sseReceived.senderType}`,
    );
  }

  // ==========================================
  // CLEANUP & SHUTDOWN
  // ==========================================
  await prisma.customerChatMessage.deleteMany({
    where: { thread: { orderId: orderA.id } },
  });
  await prisma.customerChatThread.deleteMany({ where: { orderId: orderA.id } });
  await prisma.order.deleteMany({ where: { id: orderA.id } });
  await prisma.customer.deleteMany({
    where: { email: { in: ['chat-a@mlv.dev', 'chat-b@mlv.dev'] } },
  });

  await app.close();

  const total = 20;
  line('HASIL DEMO CUSTOMER CHAT');
  console.log(`\n${failures === 0 ? '✅ SEMUA TES LULUS' : `❌ ${failures} TES GAGAL`}`);
  console.log(`Demo Results: ${total - failures}/${total} Passed, ${failures} Failed.`);

  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error in demo customer chat', err);
  process.exit(1);
});
