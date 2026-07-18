/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO CHECKOUT — Fase 10 Bagian 2
 *
 * Membuktikan alur checkout lengkap dan aman dari manipulasi harga.
 *
 * Jalankan: pnpm --filter @mlv/api demo:checkout
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { ActorType } from '@mlv/auth';
import { AuthService } from '../src/domains/identity-access/services/auth.service';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

const DEMO_PORT = 3993;
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

  // 1. Setup/seed data dasar
  line('1. MENYIAPKAN DATA SEED UNTUK DEMO CHECKOUT');

  // Clean up previous runs
  await prisma.orderMaterial.deleteMany({
    where: { orderItem: { order: { customer: { email: 'budi-demo@mlv.dev' } } } },
  });

  const budiOrders = await prisma.order.findMany({
    where: { customer: { email: 'budi-demo@mlv.dev' } },
    select: { id: true },
  });
  const budiOrderIds = budiOrders.map((o) => o.id);

  await prisma.stockReservation.deleteMany({
    where: { orderId: { in: budiOrderIds } },
  });
  await prisma.invoice.deleteMany({
    where: { order: { customer: { email: 'budi-demo@mlv.dev' } } },
  });
  await prisma.payment.deleteMany({
    where: { order: { customer: { email: 'budi-demo@mlv.dev' } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { customer: { email: 'budi-demo@mlv.dev' } } },
  });
  await prisma.order.deleteMany({ where: { customer: { email: 'budi-demo@mlv.dev' } } });
  await prisma.customer.deleteMany({
    where: {
      OR: [
        { email: { in: ['budi-demo@mlv.dev', 'siti-demo@mlv.dev'] } },
        { noHp: { in: ['08123456789', '08123456788'] } },
      ],
    },
  });

  // Create Customers
  const customerA = await prisma.customer.create({
    data: { nama: 'Budi Demo', noHp: '08123456789', email: 'budi-demo@mlv.dev' },
  });
  const customerB = await prisma.customer.create({
    data: { nama: 'Siti Demo', noHp: '08123456788', email: 'siti-demo@mlv.dev' },
  });

  // Ensure Product Price List exists
  await prisma.productPriceList.upsert({
    where: { productType: 'Kaos' },
    update: { hargaDasarPerPcs: 85000 },
    create: { productType: 'Kaos', hargaDasarPerPcs: 85000 },
  });

  // Setup Materials & BOM
  let materialKain = await prisma.material.findFirst({
    where: { nama: 'Kain Cotton Combed 30s' },
  });
  if (!materialKain) {
    materialKain = await prisma.material.create({
      data: { nama: 'Kain Cotton Combed 30s', kategori: 'KAIN', satuan: 'meter' },
    });
  }

  let materialLabel = await prisma.material.findFirst({
    where: { nama: 'Label MLV' },
  });
  if (!materialLabel) {
    materialLabel = await prisma.material.create({
      data: { nama: 'Label MLV', kategori: 'AKSESORIS', satuan: 'pcs' },
    });
  }

  await prisma.billOfMaterial.upsert({
    where: { productType_materialId: { productType: 'Kaos', materialId: materialKain.id } },
    update: { qtyPerUnit: 2.0 },
    create: { productType: 'Kaos', materialId: materialKain.id, qtyPerUnit: 2.0 },
  });

  await prisma.billOfMaterial.upsert({
    where: { productType_materialId: { productType: 'Kaos', materialId: materialLabel.id } },
    update: { qtyPerUnit: 1.0 },
    create: { productType: 'Kaos', materialId: materialLabel.id, qtyPerUnit: 1.0 },
  });

  // Setup Warehouse & Stock
  const warehouse =
    (await prisma.warehouse.findFirst()) ||
    (await prisma.warehouse.create({
      data: { nama: 'Gudang Utama', lokasi: 'Bandung' },
    }));

  await prisma.stockBalance.upsert({
    where: { materialId_warehouseId: { materialId: materialKain.id, warehouseId: warehouse.id } },
    update: { qtyAvailable: 100, qtyReserved: 0 },
    create: {
      materialId: materialKain.id,
      warehouseId: warehouse.id,
      qtyAvailable: 100,
      qtyReserved: 0,
    },
  });

  await prisma.stockBalance.upsert({
    where: { materialId_warehouseId: { materialId: materialLabel.id, warehouseId: warehouse.id } },
    update: { qtyAvailable: 50, qtyReserved: 0 },
    create: {
      materialId: materialLabel.id,
      warehouseId: warehouse.id,
      qtyAvailable: 50,
      qtyReserved: 0,
    },
  });

  console.log('Seed data setup berhasil!');

  // Generate Cookies/Tokens
  const authService = app.get(AuthService);
  const tokenA = (authService as any).issueCustomerToken(customerA).accessToken;
  const tokenB = (authService as any).issueCustomerToken(customerB).accessToken;

  const headersA = {
    'Content-Type': 'application/json',
    cookie: `mlv_customer_token=${tokenA}`,
  };

  const headersB = {
    'Content-Type': 'application/json',
    cookie: `mlv_customer_token=${tokenB}`,
  };

  // 2. Check Availability
  line('2. GET /orders/check-availability — CEK KETERSEDIAAN BAHAN REAL-TIME');
  const availRes = await fetch(`${BASE}/orders/check-availability?productType=Kaos&qty=10`, {
    headers: headersA,
  });
  check('Check Availability 200 OK', availRes.ok);
  const availResult = await availRes.json();
  check('Ketersediaan bernilai true', availResult.available === true, JSON.stringify(availResult));

  // 3. Create Draft Order
  line('3. POST /orders — MEMBUAT DRAF PESANAN');
  const orderRes = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ customerId: customerA.id }),
  });
  check('Create Order 201 Created', orderRes.ok);
  const orderObj = await orderRes.json();
  const orderId = orderObj.id;
  check('Status awal order adalah DRAFT', orderObj.status === 'DRAFT', `status=${orderObj.status}`);

  // 4. Add Order Item with Price Manipulation Check
  line('4. POST /orders/:id/items — VERIFIKASI PENCEGAHAN MANIPULASI HARGA OLEH CUSTOMER');
  const itemRes = await fetch(`${BASE}/orders/${orderId}/items`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      productType: 'Kaos',
      basePriceSnapshot: 1000, // manipulasi: mengirim harga sangat murah
      sizes: [{ ukuran: 'S', qty: 10 }],
    }),
  });
  check('Add Item 201 Created', itemRes.ok);
  const itemObj = await itemRes.json();

  // Ambil langsung dari DB untuk memverifikasi snapshot harga
  const dbItem = await prisma.orderItem.findUnique({
    where: { id: itemObj.id },
  });
  check(
    'Server mengabaikan manipulasi harga client dan mengambil dari ProductPriceList',
    dbItem?.basePriceSnapshot === 85000,
    `db_price=${dbItem?.basePriceSnapshot} (diabaikan: 1000)`,
  );

  // 5. Test Status Gate: Buat Payment DP di status DRAFT
  line('5. POST /payments — GERBANG STATUS: TOLAK PEMBAYARAN DI STATE DRAFT');
  const failPayRes = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      orderId,
      jenis: 'DP',
      metode: 'transfer',
    }),
  });
  check('Request ditolak (400 Bad Request)', failPayRes.status === 400);
  const failPayBody = await failPayRes.json();
  check(
    'Pesan error sesuai status gate',
    failPayBody.message.includes('MENUNGGU_PEMBAYARAN_DP'),
    failPayBody.message,
  );

  // 6. Checkout (DRAFT -> MENUNGGU_PEMBAYARAN_DP)
  line('6. PATCH /orders/:id/status — CHECKOUT & ATOMIC STOCK RESERVATION');
  const checkoutRes = await fetch(`${BASE}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: headersA,
    body: JSON.stringify({
      status: 'MENUNGGU_PEMBAYARAN_DP',
    }),
  });
  check('Checkout 200 OK', checkoutRes.ok);

  // Verifikasi stock balance ter-reserve di DB
  const kainBal = await prisma.stockBalance.findUnique({
    where: { materialId_warehouseId: { materialId: materialKain.id, warehouseId: warehouse.id } },
  });
  check(
    'Kain ter-reserve 20m (10 pcs Kaos * 2m/Kaos)',
    kainBal?.qtyReserved === 20,
    `reserved=${kainBal?.qtyReserved}`,
  );

  // 7. Test Ownership Gate: Customer B membayar order Customer A
  line('7. POST /payments — GERBANG AKSES/KEPEMILIKAN: CUSTOMER LAIN DITOLAK BAYAR');
  const wrongPayRes = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: headersB,
    body: JSON.stringify({
      orderId,
      jenis: 'DP',
      metode: 'transfer',
    }),
  });
  check('Request ditolak (403 Forbidden)', wrongPayRes.status === 403);

  // 8. Buat Payment DP Sukses (Auto-calculate DP 50%)
  line('8. POST /payments — BUAT PEMBAYARAN DP 50% OLEH PELANGGAN');
  const payRes = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      orderId,
      jenis: 'DP',
      metode: 'midtrans_snap',
    }),
  });
  check('Buat Payment 201 Created', payRes.ok);
  const payment = await payRes.json();
  // Total order = 10 * 85000 = 850000. DP 50% = 425000.
  check(
    'Jumlah DP dihitung otomatis 50% oleh backend',
    payment.payment.jumlah === 425000,
    `jumlah_dp=${payment.payment.jumlah}`,
  );
  check('Halaman redirect Midtrans ter-generate', !!payment.midtransRedirectUrl);

  // 9. Test Status Gate: Buat Payment Pelunasan di status MENUNGGU_PEMBAYARAN_DP
  line('9. POST /payments — GERBANG STATUS: TOLAK PELUNASAN DI STATE MENUNGGU_PEMBAYARAN_DP');
  const pelunasanFailRes = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      orderId,
      jenis: 'PELUNASAN',
      metode: 'transfer',
    }),
  });
  check('Request ditolak (400 Bad Request)', pelunasanFailRes.status === 400);
  const pelunasanFailBody = await pelunasanFailRes.json();
  check(
    'Pesan error sesuai status gate',
    pelunasanFailBody.message.includes('MENUNGGU_PELUNASAN'),
    pelunasanFailBody.message,
  );

  // 10. Simulasi Webhook Sukses Midtrans (DP Lunas -> ANTREAN)
  line('10. POST /payments/webhook/midtrans — SIMULASI WEBHOOK MIDTRANS SUKSES');
  const paymentId = payment.payment.id;
  const serverKey = app.get(ConfigService).get('MIDTRANS_SERVER_KEY') ?? 'mock_server_key';
  const grossAmount = '425000.00';
  const midtransOrderId = `payment_${paymentId}`;

  // Signature: SHA512(order_id + status_code + gross_amount + serverKey)
  const signatureString = `${midtransOrderId}200${grossAmount}${serverKey}`;
  const signatureKey = crypto.createHash('sha512').update(signatureString).digest('hex');

  const webhookRes = await fetch(`${BASE}/payments/webhook/midtrans`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-midtrans-signature-key': signatureKey,
    },
    body: JSON.stringify({
      order_id: midtransOrderId,
      status_code: '200',
      gross_amount: grossAmount,
      transaction_status: 'settlement',
      transaction_id: `tx-demo-${Date.now()}`,
    }),
  });
  check('Webhook 200 OK', webhookRes.ok);

  // Poll status order sampai ter-update ke ANTREAN oleh worker/event bus
  console.log('  … menunggu status order beralih ke ANTREAN (via event bus) …');
  const statusResult = await pollOrderStatus(orderId, 'ANTREAN');
  check(
    'Status order terbaru beralih ke ANTREAN',
    statusResult === 'ANTREAN',
    `status=${statusResult}`,
  );

  // Clean up and shutdown
  await app.close();

  line('SELESAI');
  console.log(`Demo Results: ${10 - failures}/10 Passed, ${failures} Failed.`);
  if (failures > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error in demo script', err);
  process.exit(1);
});
