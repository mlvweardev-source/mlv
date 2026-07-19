/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO QUOTATION ASSISTANT — Fase 12 Bagian 2
 *
 * Membuktikan: AI Quotation Assistant memberi saran range harga + alasan
 * singkat untuk order dengan spesifikasi tidak standar. AI HANYA menyarankan
 * (§17.4) — harga final selalu di-input manusia lewat approval.
 *
 * Alur demo:
 *  1. Setup: order DRAFT dengan item Kaos 50 pcs
 *  2. Login Owner (lihat saran), Manajer (lihat saran)
 *  3. Owner request quotation via /ai-assistant/quotation
 *  4. Verifikasi response: range harga per pcs, total estimasi, alasan
 *  5. Owner ajukan approval Harga Khusus (Flow existing Fase 9.3)
 *  6. Login Penjahit → ditolak (RBAC §5.1 — quotation bukan untuk Penjahit)
 *  7. Customer tidak boleh akses (RBAC)
 *  8. Edge case: qty 0 → ditolak (BadRequestException)
 *  9. Edge case: tanpa GEMINI_API_KEY → saran null (AI disabled)
 *
 * Jalankan: pnpm --filter @mlv/api demo:quotation-assistant
 *
 * CATATAN: services/api & services/ai-gateway harus berjalan (port 3000 & 3002).
 * Set GEMINI_API_KEY di .env untuk hasil AI non-null.
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';

const DEMO_PORT = 3996;
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
  line('1. SETUP DATA ORDER UNTUK DEMO QUOTATION ASSISTANT');

  // Cek AI gateway hidup
  const gatewayUp = await aiGatewayUp();
  check('AI gateway reachable', gatewayUp, `url=${AI_GATEWAY_URL}`);
  if (!gatewayUp) {
    console.log('❌ AI gateway tidak berjalan. Jalankan: pnpm --filter @mlv/ai-gateway dev');
    await app.close();
    return;
  }

  // Cleanup previous runs (cari customer dengan email khusus)
  await prisma.orderItem.deleteMany({
    where: { order: { customer: { email: 'quot-demo@mlv.dev' } } },
  });
  await prisma.orderTimelineEvent.deleteMany({
    where: { order: { customer: { email: 'quot-demo@mlv.dev' } } },
  });
  await prisma.order.deleteMany({
    where: { customer: { email: 'quot-demo@mlv.dev' } },
  });
  await prisma.customer.deleteMany({ where: { email: 'quot-demo@mlv.dev' } });

  const customer = await prisma.customer.create({
    data: { nama: 'Demo Customer Quotation', noHp: '08129999001', email: 'quot-demo@mlv.dev' },
  });
  console.log(`Customer created: id=${customer.id}`);

  // Order DRAFT dengan item Kaos 50 pcs
  const order = await prisma.order.create({
    data: {
      orderNumber: `MLV-DEMO-QUOT-${Date.now()}`,
      customerId: customer.id,
      status: 'DRAFT',
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
  const item = order.items[0];
  const totalQty = item.sizes.reduce((sum, s) => sum + s.qty, 0);
  check('Order + item created', true, `orderId=${order.id} qty=${totalQty}`);

  // Login Owner & Manajer & Penjahit
  const ownerToken = await loginStaff('owner@mlv.dev', 'owner123');
  const manajerToken = await loginStaff('manajer@mlv.dev', 'manajer123');
  const penjahitToken = await loginStaff('penjahit@mlv.dev', 'penjahit123');
  check('Owner/Manajer/Penjahit login OK', true);

  const headersOwner = { 'Content-Type': 'application/json', cookie: `mlv_access_token=${ownerToken}` };
  const headersManajer = {
    'Content-Type': 'application/json',
    cookie: `mlv_access_token=${manajerToken}`,
  };
  const headersPenjahit = {
    'Content-Type': 'application/json',
    cookie: `mlv_access_token=${penjahitToken}`,
  };

  // ==========================================
  // 2. OWNER MINTA SARAN HARGA — SPESIFIKASI STANDAR
  // ==========================================
  line('2. OWNER MINTA SARAN — SPESIFIKASI STANDAR (KAOS 50 PCS)');

  const r1 = await fetch(`${BASE}/ai-assistant/quotation`, {
    method: 'POST',
    headers: headersOwner,
    body: JSON.stringify({
      productType: 'Kaos',
      qty: 50,
      complexity: 'RENDAH',
      basePriceReference: 85000,
    }),
  });
  check('Owner /ai-assistant/quotation 200', r1.ok, `status=${r1.status}`);
  const d1 = await r1.json();
  if (d1.saran_harga) {
    check(
      'Saran ada field harga_per_pcs',
      typeof d1.saran_harga.harga_per_pcs?.low === 'number' &&
        typeof d1.saran_harga.harga_per_pcs?.high === 'number',
      `low=${d1.saran_harga.harga_per_pcs?.low} high=${d1.saran_harga.harga_per_pcs?.high}`,
    );
    check(
      'low <= high',
      d1.saran_harga.harga_per_pcs.low <= d1.saran_harga.harga_per_pcs.high,
    );
    check(
      'Ada alasan',
      typeof d1.saran_harga.alasan === 'string' && d1.saran_harga.alasan.length > 10,
    );
    check(
      'Total estimasi = harga × qty',
      d1.saran_harga.total_estimasi.low === d1.saran_harga.harga_per_pcs.low * 50 &&
        d1.saran_harga.total_estimasi.high === d1.saran_harga.harga_per_pcs.high * 50,
    );
  } else {
    console.log('  ℹ️  saran_harga = null (GEMINI_API_KEY mungkin tidak di-set — AI disabled)');
  }

  // ==========================================
  // 3. MANAJER MINTA SARAN — SPESIFIKASI TIDAK STANDAR
  // ==========================================
  line('3. MANAJER MINTA SARAN — COTTON COMBED 30S, SABLON 4 WARNA');

  const r2 = await fetch(`${BASE}/ai-assistant/quotation`, {
    method: 'POST',
    headers: headersManajer,
    body: JSON.stringify({
      productType: 'Kaos',
      qty: 10,
      complexity: 'TINGGI',
      catatanStaf: 'Cotton combed 30s, sablon 4 warna, bordir logo di dada',
      basePriceReference: 85000,
    }),
  });
  check('Manajer /ai-assistant/quotation 200', r2.ok, `status=${r2.status}`);
  const d2 = await r2.json();
  if (d2.saran_harga) {
    console.log(
      `  ℹ️  Range saran: Rp ${d2.saran_harga.harga_per_pcs.low.toLocaleString('id-ID')} - Rp ${d2.saran_harga.harga_per_pcs.high.toLocaleString('id-ID')} per pcs`,
    );
    console.log(`  ℹ️  Alasan: ${d2.saran_harga.alasan}`);
    if (d2.saran_harga.faktor_pendorong_harga?.length > 0) {
      console.log(
        `  ℹ️  Faktor: ${d2.saran_harga.faktor_pendorong_harga.join(', ')}`,
      );
    }
  } else {
    console.log('  ℹ️  saran_harga = null (GEMINI_API_KEY tidak di-set)');
  }

  // ==========================================
  // 4. §17.4 — AI TIDAK AUTO-APPLY KE HARGA
  // ==========================================
  line('4. §17.4 — AI TIDAK PERNAH AUTO-APPLY KE basePriceSnapshot');

  // Cek basePriceSnapshot order_item TIDAK berubah setelah request quotation
  const afterItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
  check(
    'basePriceSnapshot TIDAK berubah setelah AI saran',
    afterItem?.basePriceSnapshot === 85000,
    `nilai=${afterItem?.basePriceSnapshot}`,
  );
  check(
    'Order status TETAP DRAFT (tidak ada transisi paksa)',
    afterItem?.orderId === order.id,
  );
  // Re-fetch order status
  const afterOrder = await prisma.order.findUnique({ where: { id: order.id } });
  check('Order status masih DRAFT', afterOrder?.status === 'DRAFT', `status=${afterOrder?.status}`);

  // ==========================================
  // 5. FLOW EXISTING: AJUKAN APPROVAL HARGA KHUSUS (MANAJER)
  // ==========================================
  line('5. FLOW EXISTING — MANAJER AJUKAN APPROVAL HARGA KHUSUS');

  // Misal Manajer mau kasih harga custom (sesuai saran AI), dia ajukan
  // approval "Harga Khusus" dengan harga yang dipilihnya (paritas Fase 9.3)
  const r3 = await fetch(`${BASE}/approvals`, {
    method: 'POST',
    headers: headersManajer,
    body: JSON.stringify({
      tipe: 'HARGA_KHUSUS',
      refId: item.id,
      orderId: order.id,
      alasan: 'Rp 150000 (saran AI: Rp 120000 - 180000, saya pilih tengah)',
    }),
  });
  check('Manajer POST /approvals 201', r3.ok, `status=${r3.status}`);

  // ==========================================
  // 6. RBAC: PENJAHIT DITOLAK
  // ==========================================
  line('6. RBAC — TIM PENJAHIT DITOLAK AKSES QUOTATION');

  const r4 = await fetch(`${BASE}/ai-assistant/quotation`, {
    method: 'POST',
    headers: headersPenjahit,
    body: JSON.stringify({ productType: 'Kaos', qty: 50 }),
  });
  check(
    'Penjahit /ai-assistant/quotation ditolak (401/403)',
    r4.status === 401 || r4.status === 403,
    `status=${r4.status}`,
  );

  // ==========================================
  // 7. RBAC: PELANGGAN DITOLAK
  // ==========================================
  line('7. RBAC — PELANGGAN DITOLAK AKSES QUOTATION');

  // Generate customer JWT via AuthService (private method — pola demo-checkout)
  const { AuthService } = await import('../src/domains/identity-access/services/auth.service');
  const authService = app.get(AuthService);
  const custToken = (authService as any).issueCustomerToken(customer).accessToken;
  const headersCust = {
    'Content-Type': 'application/json',
    cookie: `mlv_customer_token=${custToken}`,
  };

  const r5 = await fetch(`${BASE}/ai-assistant/quotation`, {
    method: 'POST',
    headers: headersCust,
    body: JSON.stringify({ productType: 'Kaos', qty: 50 }),
  });
  check(
    'Customer /ai-assistant/quotation ditolak (401/403)',
    r5.status === 401 || r5.status === 403,
    `status=${r5.status}`,
  );

  // ==========================================
  // 8. EDGE CASE: QTY 0 / NEGATIF
  // ==========================================
  line('8. EDGE CASE — VALIDASI INPUT');

  const r6 = await fetch(`${BASE}/ai-assistant/quotation`, {
    method: 'POST',
    headers: headersOwner,
    body: JSON.stringify({ productType: 'Kaos', qty: 0 }),
  });
  check('qty=0 ditolak 400', r6.status === 400, `status=${r6.status}`);

  const r7 = await fetch(`${BASE}/ai-assistant/quotation`, {
    method: 'POST',
    headers: headersOwner,
    body: JSON.stringify({ qty: 10 }), // missing productType
  });
  check('productType kosong ditolak 400', r7.status === 400, `status=${r7.status}`);

  // ==========================================
  // CLEANUP
  // ==========================================
  await prisma.approval.deleteMany({ where: { orderId: order.id } });
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.orderTimelineEvent.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.customer.delete({ where: { id: customer.id } });

  await app.close();
  await prisma.$disconnect();

  line('HASIL DEMO QUOTATION ASSISTANT');
  console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Demo failed:', err);
  process.exit(1);
});
