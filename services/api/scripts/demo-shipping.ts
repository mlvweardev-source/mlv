/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO SHIPPING — Fase 7 (§23: "Status pengiriman terhubung ke event pelunasan")
 *
 * Membuktikan 3 hal:
 *  1. GATE LUNAS  : POST /shipments di order yang belum LUNAS → DITOLAK jelas;
 *                   setelah PaymentSucceeded(PELUNASAN) → order LUNAS → sukses.
 *  2. EVENT       : ShipmentCreated ter-publish ke BullMQ → OrderEventsProcessor
 *                   transisi order → DIKIRIM (tanpa panggilan langsung antar modul).
 *  3. TRACKING    : GET /shipments/:token/track PUBLIK (tanpa Authorization header)
 *                   → 200 dengan token benar (response minimal, tanpa data sensitif),
 *                   → 404 dengan token salah.
 *
 * Boot full HTTP app (NestFactory.create + listen) supaya endpoint publik
 * benar-benar diuji lewat HTTP tanpa auth — bukan panggilan service langsung.
 *
 * Jalankan: pnpm --filter @mlv/api demo:shipping
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { EventBusService } from '../src/event-bus/event-bus.service';
import { OrderService } from '../src/domains/order/services/order.service';
import { ShippingService } from '../src/domains/shipping/services/shipping.service';
import { prisma } from '@mlv/db';
import { ActorType } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { EVENT_NAMES, ALL_QUEUES, QUEUES } from '@mlv/types';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_PORT = 3999;

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

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(DEMO_PORT); // HTTP listener → uji endpoint publik sungguhan

  const eventBus = app.get(EventBusService);
  const orderService = app.get(OrderService);
  const shippingService = app.get(ShippingService);

  const queues: Record<string, Queue> = {};
  for (const name of ALL_QUEUES) {
    queues[name] = app.get<Queue>(getQueueToken(name));
  }

  line('0. Bersihkan queue untuk hitungan demo yang bersih');
  for (const name of ALL_QUEUES) {
    await queues[name].obliterate({ force: true });
  }
  console.log('Queue dibersihkan:', ALL_QUEUES.join(', '));

  const actor: JwtPayload = {
    sub: 'demo-owner',
    email: 'owner@mlv.dev',
    role: 'OWNER',
    actorType: ActorType.USER,
  } as any;

  // ------------------------------------------------------------------
  line('1. Siapkan order sampai status MENUNGGU_PELUNASAN (belum LUNAS)');
  const customer = await prisma.customer.findFirst();
  if (!customer) throw new Error('Tidak ada customer seeded. Jalankan seed dulu.');

  const created = await orderService.createOrder({ customerId: customer.id }, actor);
  await orderService.addOrderItem(
    created.id,
    { productType: 'Kaos', basePriceSnapshot: 75000, sizes: [{ ukuran: 'L', qty: 5 }] } as any,
    actor,
  );
  await orderService.updateStatus(created.id, { status: 'MENUNGGU_PEMBAYARAN_DP' } as any, actor);
  // Langsung set MENUNGGU_PELUNASAN via DB untuk mempersingkat demo
  // (jalur penuh DP→produksi→pelunasan sudah dibuktikan demo-cascade Fase 6).
  await prisma.order.update({
    where: { id: created.id },
    data: { status: 'MENUNGGU_PELUNASAN' },
  });
  console.log(`Order ${created.orderNumber} status: MENUNGGU_PELUNASAN`);

  // ------------------------------------------------------------------
  line('2. BUKTI GATE — POST /shipments saat order BELUM LUNAS harus DITOLAK');
  try {
    await shippingService.createShipment({ orderId: created.id, kurir: 'JNE' });
    check('Gate LUNAS menolak order belum lunas', false, 'malah berhasil!');
  } catch (e: any) {
    check(
      'Gate LUNAS menolak order belum lunas',
      e.status === 400 && /belum berstatus LUNAS/.test(e.message),
      `HTTP ${e.status}: "${e.message}"`,
    );
  }

  // ------------------------------------------------------------------
  line('3. PaymentSucceeded(PELUNASAN) → order LUNAS (§23: terhubung event pelunasan)');
  const payment = await prisma.payment.create({
    data: {
      orderId: created.id,
      jenis: 'PELUNASAN',
      metode: 'demo',
      jumlah: 500000,
      status: 'SUCCESS',
      webhookEventId: `demo-shipping-${Date.now()}`,
    },
  });
  await eventBus.publish(EVENT_NAMES.PaymentSucceeded, {
    paymentId: payment.id,
    orderId: created.id,
    jenis: 'PELUNASAN' as const,
    jumlah: payment.jumlah,
    customerId: customer.id,
    orderNumber: created.orderNumber,
    customerNama: customer.nama,
    customerNoHp: customer.noHp,
  });
  await sleep(3000);
  const afterPelunasan = await prisma.order.findUnique({ where: { id: created.id } });
  check(
    'Order transisi ke LUNAS via BullMQ (order-events)',
    afterPelunasan!.status === 'LUNAS',
    `status=${afterPelunasan!.status}`,
  );

  // ------------------------------------------------------------------
  line('4. POST /shipments saat LUNAS → sukses + ShipmentCreated → order DIKIRIM');
  const shipment = await shippingService.createShipment({
    orderId: created.id,
    kurir: 'JNE',
    noResi: 'JNE-DEMO-001',
    biayaKirim: 18000,
  });
  check('Shipment dibuat', !!shipment.id, `id=${shipment.id}, token=${shipment.trackingToken}`);

  console.log('Menunggu ShipmentCreated dikonsumsi OrderEventsProcessor...');
  await sleep(3000);

  const afterShipment = await prisma.order.findUnique({
    where: { id: created.id },
    include: { timeline: { orderBy: { createdAt: 'asc' } } },
  });
  check(
    'Order transisi LUNAS → DIKIRIM via ShipmentCreated (BullMQ)',
    afterShipment!.status === 'DIKIRIM',
    `status=${afterShipment!.status}`,
  );
  console.log('\nTimeline events:');
  for (const t of afterShipment!.timeline) {
    console.log(`  - ${t.tipeEvent}: ${t.deskripsi}`);
  }

  const orderEventCounts = await queues[QUEUES.ORDER_EVENTS].getJobCounts('completed', 'failed');
  const notifCounts = await queues[QUEUES.NOTIFICATION_EVENTS].getJobCounts('completed', 'waiting');
  console.log(
    `\nJob counts — order-events: completed=${orderEventCounts.completed} failed=${orderEventCounts.failed}; ` +
      `notification-events: completed=${notifCounts.completed} waiting=${notifCounts.waiting}`,
  );

  // ------------------------------------------------------------------
  line('5. BUKTI IDEMPOTENCY — re-publish ShipmentCreated yang sama');
  const timelineBefore = afterShipment!.timeline.length;
  await eventBus.publish(EVENT_NAMES.ShipmentCreated, {
    shipmentId: shipment.id,
    orderId: created.id,
    orderNumber: created.orderNumber,
    kurir: 'JNE',
    trackingToken: shipment.trackingToken,
    createdAt: new Date(),
    noResi: shipment.noResi,
    customerId: customer.id,
    customerNama: customer.nama,
    customerNoHp: customer.noHp,
  });
  await sleep(2500);
  const afterDup = await prisma.order.findUnique({
    where: { id: created.id },
    include: { timeline: true },
  });
  check(
    'Idempoten: status & timeline TIDAK berubah',
    afterDup!.status === 'DIKIRIM' && afterDup!.timeline.length === timelineBefore,
    `status=${afterDup!.status}, timeline ${timelineBefore}→${afterDup!.timeline.length}`,
  );

  // ------------------------------------------------------------------
  line('6. PUBLIC TRACKING via HTTP TANPA AUTH — token benar vs salah');
  const base = `http://localhost:${DEMO_PORT}`;

  const okRes = await fetch(`${base}/shipments/${shipment.trackingToken}/track`);
  const okBody = await okRes.json();
  check(
    'Token benar → 200 tanpa Authorization header',
    okRes.status === 200 && okBody.orderNumber === created.orderNumber,
    `HTTP ${okRes.status}, body=${JSON.stringify(okBody)}`,
  );
  const sensitiveLeak = ['biayaKirim', 'alamatPengiriman', 'trackingToken', 'customerId'].filter(
    (k) => k in okBody,
  );
  check(
    'Response publik tidak bocorkan data sensitif',
    sensitiveLeak.length === 0,
    sensitiveLeak.length ? `bocor: ${sensitiveLeak.join(',')}` : 'hanya status/kurir/resi/tanggal',
  );

  const wrongToken = '00000000-0000-4000-8000-000000000000';
  const badRes = await fetch(`${base}/shipments/${wrongToken}/track`);
  check('Token salah (uuid valid) → 404', badRes.status === 404, `HTTP ${badRes.status}`);

  // orderId polos TIDAK bisa dipakai sebagai token (keputusan #4)
  const idRes = await fetch(`${base}/shipments/${created.id}/track`);
  check(
    'orderId polos dipakai sebagai token → 404 (tidak bisa ditebak)',
    idRes.status === 404,
    `HTTP ${idRes.status}`,
  );

  // Endpoint staff tetap terkunci tanpa auth
  const staffRes = await fetch(`${base}/shipments`);
  check(
    'GET /shipments (staff) tanpa auth → 401',
    staffRes.status === 401,
    `HTTP ${staffRes.status}`,
  );

  // ------------------------------------------------------------------
  line('7. Cleanup data demo');
  await prisma.orderTimelineEvent.deleteMany({ where: { orderId: created.id } });
  await prisma.shipment.deleteMany({ where: { orderId: created.id } });
  await prisma.payment.deleteMany({ where: { orderId: created.id } });
  await prisma.stockReservation.deleteMany({ where: { orderId: created.id } });
  await prisma.orderMaterial.deleteMany({ where: { orderItem: { orderId: created.id } } });
  await prisma.orderService.deleteMany({ where: { orderItem: { orderId: created.id } } });
  await prisma.orderSize.deleteMany({ where: { orderItem: { orderId: created.id } } });
  await prisma.orderItem.deleteMany({ where: { orderId: created.id } });
  await prisma.order.delete({ where: { id: created.id } });
  console.log('Data demo dibersihkan.');

  line(failures === 0 ? 'SEMUA BUKTI LULUS ✅' : `${failures} BUKTI GAGAL ❌`);

  await app.close();
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('DEMO GAGAL:', err);
  process.exit(1);
});
