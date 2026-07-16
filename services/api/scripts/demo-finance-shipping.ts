/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO FINANCE, APPROVAL, & SHIPPING — Fase 9 Bagian 3
 *
 * Membuktikan lewat HTTP sungguhan (bukan panggilan service langsung):
 *  1. PAYMENT     : POST /payments (Manajer, jenis DP, midtrans_snap) →
 *                   link Snap ter-generate (sandbox); invoice DP otomatis;
 *                   GET /payments?orderId= untuk section di halaman Order.
 *  2. APPROVAL    : Manajer ajukan DISKON → muncul di inbox Owner (PENDING);
 *                   Owner REJECT → status REJECTED; Manajer ajukan lagi →
 *                   Owner APPROVE → efek diskon kelihatan di order
 *                   (discount_nominal terisi + timeline DISKON_APPLIED);
 *                   Manajer GET /approvals → hanya request miliknya;
 *                   Manajer decide → 403.
 *  3. PROFIT SHARING: Manajer GET/POST /profit-sharing → 401/403 (❌ total);
 *                   Owner → CRUD lengkap jalan (create/list/update/delete).
 *  4. SHIPPING    : POST /shipments saat order BELUM LUNAS → 400 (gate);
 *                   set LUNAS → POST /shipments sukses → event ShipmentCreated
 *                   → status order jadi DIKIRIM (poll); GET /shipments list.
 *
 * Jalankan: pnpm --filter @mlv/api demo:finance-shipping
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';

const DEMO_PORT = 3996;
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

function parseCookies(response: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    cookies[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function login(email: string, password: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login ${email} gagal: ${res.status}`);
  return parseCookies(res);
}

async function pollOrderStatus(
  orderId: string,
  expected: string,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    last = order?.status ?? '';
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(DEMO_PORT);

  const customer = await prisma.customer.findFirst();
  if (!customer) {
    console.error('Seed dasar tidak ditemukan — jalankan `pnpm --filter @mlv/db db:seed` dulu.');
    process.exit(1);
  }

  // Order demo: item + size supaya kalkulasi invoice masuk akal
  const order = await prisma.order.create({
    data: {
      orderNumber: `DEMO-FIN-${Date.now()}`,
      customerId: customer.id,
      status: 'ANTREAN',
      items: {
        create: {
          productType: 'Kaos',
          basePriceSnapshot: 100000,
          sizes: { create: [{ ukuran: 'L', qty: 10 }] },
        },
      },
    },
    include: { items: true },
  });

  let shipmentId: string | null = null;

  try {
    const ownerCookies = await login('owner@mlv.dev', 'owner123');
    const manajerCookies = await login('manajer@mlv.dev', 'manajer123');
    const penjahitCookies = await login('penjahit@mlv.dev', 'penjahit123');

    // ================================================================
    line('1. PAYMENT — buat link Snap DP dari halaman Order');
    // ================================================================
    const createPaymentRes = await fetch(`${BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({
        orderId: order.id,
        jenis: 'DP',
        metode: 'midtrans_snap',
        jumlah: 500000,
      }),
    });
    const paymentResult = (await createPaymentRes.json()) as any;
    check(
      'POST /payments (Manajer, DP custom Rp 500.000) → 201',
      createPaymentRes.status === 201,
      `status=${createPaymentRes.status}`,
    );
    check(
      'Link Midtrans Snap ter-generate (sandbox)',
      typeof paymentResult.midtransRedirectUrl === 'string' &&
        paymentResult.midtransRedirectUrl.includes('midtrans'),
      paymentResult.midtransRedirectUrl,
    );

    const invoiceListRes = await fetch(`${BASE}/invoices?orderId=${order.id}`, {
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const invoicesForOrder = (await invoiceListRes.json()) as any[];
    check(
      'Invoice DP otomatis dibuat untuk order',
      invoiceListRes.status === 200 && invoicesForOrder.some((i) => i.jenis === 'DP'),
      `invoice=${invoicesForOrder.length}`,
    );

    const paymentListRes = await fetch(`${BASE}/payments?orderId=${order.id}`, {
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const paymentsForOrder = (await paymentListRes.json()) as any[];
    check(
      'GET /payments?orderId= → riwayat payment order (section halaman Order)',
      paymentListRes.status === 200 && paymentsForOrder.length === 1,
    );

    const penjahitPayments = await fetch(`${BASE}/payments`, {
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    check(
      'Penjahit GET /payments → ditolak (401/403, §5.1 Finance ❌)',
      penjahitPayments.status === 401 || penjahitPayments.status === 403,
      `status=${penjahitPayments.status}`,
    );

    // ================================================================
    line('2. APPROVAL — Manajer ajukan DISKON → Owner reject → ajukan lagi → approve');
    // ================================================================
    const ajukan1 = await fetch(`${BASE}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({
        tipe: 'DISKON',
        refId: order.id,
        orderId: order.id,
        alasan: 'Rp 50000',
      }),
    });
    const approval1 = (await ajukan1.json()) as any;
    check('Manajer POST /approvals (DISKON Rp 50000) → 201', ajukan1.status === 201);

    const inboxOwner = await fetch(`${BASE}/approvals?status=PENDING`, {
      headers: { cookie: cookieHeader(ownerCookies) },
    });
    const pendingList = (await inboxOwner.json()) as any[];
    check(
      'Muncul di inbox Owner (PENDING) + nama pengaju ter-enrich',
      pendingList.some((a) => a.id === approval1.id && a.requesterNama === 'Manajer Produksi'),
    );

    // Manajer coba decide sendiri → 403
    const manajerDecide = await fetch(`${BASE}/approvals/${approval1.id}/decide`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    check(
      'Manajer PATCH decide → 403 (hanya Owner)',
      manajerDecide.status === 403,
      `status=${manajerDecide.status}`,
    );

    // Owner REJECT
    const rejectRes = await fetch(`${BASE}/approvals/${approval1.id}/decide`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(ownerCookies) },
      body: JSON.stringify({ status: 'REJECTED', alasan: 'Margin terlalu tipis' }),
    });
    const rejected = (await rejectRes.json()) as any;
    check(
      'Owner REJECT → status REJECTED, order TIDAK didiskon',
      rejectRes.status === 200 && rejected.status === 'REJECTED',
    );
    const orderAfterReject = await prisma.order.findUnique({ where: { id: order.id } });
    check(
      'discount_nominal masih kosong setelah reject',
      orderAfterReject?.discountNominal == null,
    );

    // Ajukan lagi → Owner APPROVE
    const ajukan2 = await fetch(`${BASE}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({
        tipe: 'DISKON',
        refId: order.id,
        orderId: order.id,
        alasan: 'Rp 50000 — pelanggan repeat order',
      }),
    });
    const approval2 = (await ajukan2.json()) as any;
    const approveRes = await fetch(`${BASE}/approvals/${approval2.id}/decide`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(ownerCookies) },
      body: JSON.stringify({ status: 'APPROVED', alasan: 'Rp 50000' }),
    });
    const approved = (await approveRes.json()) as any;
    check(
      'Ajukan ulang → Owner APPROVE → status APPROVED',
      approveRes.status === 200 && approved.status === 'APPROVED',
    );

    const orderAfterApprove = await prisma.order.findUnique({
      where: { id: order.id },
      include: { timeline: true },
    });
    check(
      'EFEK NYATA: discount_nominal = 50000 di order',
      orderAfterApprove?.discountNominal === 50000,
      `discount=${orderAfterApprove?.discountNominal}`,
    );
    check(
      'Timeline order mencatat DISKON_APPLIED',
      !!orderAfterApprove?.timeline.some((t) => t.tipeEvent === 'DISKON_APPLIED'),
    );

    // Manajer hanya lihat request miliknya
    const manajerInbox = await fetch(`${BASE}/approvals`, {
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const manajerList = (await manajerInbox.json()) as any[];
    const manajer = await prisma.user.findUnique({ where: { email: 'manajer@mlv.dev' } });
    check(
      'Manajer GET /approvals → HANYA request yang dia ajukan sendiri',
      manajerList.length > 0 && manajerList.every((a) => a.requestedBy === manajer!.id),
      `dilihat=${manajerList.length}, semua requestedBy dirinya`,
    );

    // ================================================================
    line('3. PROFIT SHARING — Owner-only (§5.1 tegas ❌ Manajer/Penjahit)');
    // ================================================================
    const manajerPs = await fetch(`${BASE}/profit-sharing`, {
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    check(
      'Manajer GET /profit-sharing → ditolak (401/403)',
      manajerPs.status === 401 || manajerPs.status === 403,
      `status=${manajerPs.status}`,
    );
    const penjahitPs = await fetch(`${BASE}/profit-sharing`, {
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    check(
      'Penjahit GET /profit-sharing → ditolak (401/403)',
      penjahitPs.status === 401 || penjahitPs.status === 403,
    );
    const manajerPsCreate = await fetch(`${BASE}/profit-sharing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({ pihak: 'manajer', persentase: 90 }),
    });
    check(
      'Manajer POST /profit-sharing → ditolak (401/403)',
      manajerPsCreate.status === 401 || manajerPsCreate.status === 403,
    );

    // Owner: CRUD lengkap
    const psCreate = await fetch(`${BASE}/profit-sharing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(ownerCookies) },
      body: JSON.stringify({ pihak: 'demo-pihak', persentase: 15, catatan: 'demo fase 9.3' }),
    });
    const psRow = (await psCreate.json()) as any;
    check('Owner POST /profit-sharing → 201', psCreate.status === 201);

    const psList = await fetch(`${BASE}/profit-sharing`, {
      headers: { cookie: cookieHeader(ownerCookies) },
    });
    const psRows = (await psList.json()) as any[];
    check(
      'Owner GET /profit-sharing → entri baru ada di list',
      psList.status === 200 && psRows.some((r) => r.id === psRow.id),
    );

    const psUpdate = await fetch(`${BASE}/profit-sharing/${psRow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(ownerCookies) },
      body: JSON.stringify({ persentase: 20 }),
    });
    const psUpdated = (await psUpdate.json()) as any;
    check(
      'Owner PATCH → persentase 15 → 20',
      psUpdate.status === 200 && psUpdated.persentase === 20,
    );

    const psDelete = await fetch(`${BASE}/profit-sharing/${psRow.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieHeader(ownerCookies) },
    });
    check('Owner DELETE → 200', psDelete.status === 200);

    // ================================================================
    line('4. SHIPPING — gate LUNAS; kirim → order jadi DIKIRIM');
    // ================================================================
    // Order masih ANTREAN → harus ditolak
    const shipTooEarly = await fetch(`${BASE}/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({ orderId: order.id, kurir: 'JNE' }),
    });
    check(
      'Order belum LUNAS → POST /shipments 400 (gate backend, tombol UI disabled)',
      shipTooEarly.status === 400,
      `status=${shipTooEarly.status} (order masih ${order.status})`,
    );

    // Set LUNAS langsung di DB (jalur pembayaran penuh sudah dibuktikan Fase 5-6)
    await prisma.order.update({ where: { id: order.id }, data: { status: 'LUNAS' } });

    const shipRes = await fetch(`${BASE}/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({ orderId: order.id, kurir: 'JNE', noResi: 'JNE123456789' }),
    });
    const shipment = (await shipRes.json()) as any;
    shipmentId = shipment.id;
    check(
      'Order LUNAS → POST /shipments 201 + trackingToken di-generate',
      shipRes.status === 201 && !!shipment.trackingToken,
      `kurir=${shipment.kurir}, resi=${shipment.noResi}`,
    );

    // Event ShipmentCreated → OrderEventsProcessor → status DIKIRIM
    const statusAfterShip = await pollOrderStatus(order.id, 'DIKIRIM');
    check(
      'Status order otomatis → DIKIRIM (via event BullMQ)',
      statusAfterShip === 'DIKIRIM',
      `status=${statusAfterShip}`,
    );

    const shipList = await fetch(`${BASE}/shipments`, {
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const shipments = (await shipList.json()) as any[];
    check(
      'GET /shipments (Manajer, §5.1 full akses) → shipment ada di daftar',
      shipList.status === 200 && shipments.some((s) => s.id === shipment.id),
    );

    const penjahitShip = await fetch(`${BASE}/shipments`, {
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    check(
      'Penjahit GET /shipments → ditolak (401/403)',
      penjahitShip.status === 401 || penjahitShip.status === 403,
    );

    // ================================================================
    line(failures === 0 ? '🎉 SEMUA BUKTI LULUS' : `❌ ${failures} BUKTI GAGAL`);
    // ================================================================
  } finally {
    // Bersihkan data demo
    if (shipmentId) {
      await prisma.shipment.delete({ where: { id: shipmentId } }).catch(() => null);
    }
    await prisma.approval.deleteMany({ where: { orderId: order.id } }).catch(() => null);
    await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => null);
    await prisma.invoice.deleteMany({ where: { orderId: order.id } }).catch(() => null);
    await prisma.profitSharing.deleteMany({ where: { pihak: 'demo-pihak' } }).catch(() => null);
    await prisma.order.delete({ where: { id: order.id } }).catch(() => null);
    await app.close();
    await prisma.$disconnect();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
