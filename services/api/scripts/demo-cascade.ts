/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO CASCADE — Fase 6 (§23)
 *
 * Membuktikan event `PaymentSucceeded` memicu cascade ke
 * Order → (OrderConfirmed) → Production + Inventory + Notification
 * TANPA panggilan langsung antar modul — semua lewat BullMQ (Redis).
 *
 * Cara kerja:
 *  1. Boot AppModule penuh (NestFactory) → semua consumer BullMQ untuk
 *     queue order/inventory/production/finance connect ke Redis.
 *     (queue notification-events dikonsumsi oleh PROSES TERPISAH
 *      services/notification — dijalankan terpisah untuk bukti lintas proses.)
 *  2. Siapkan data: order Kaos + service sablon → checkout (reservasi stok)
 *     → buat payment DP.
 *  3. Publish PaymentSucceeded (persis yang dilakukan webhook Midtrans
 *     setelah verifikasi signature).
 *  4. Amati cascade lewat state DB + hitungan job per queue.
 *  5. Publish event yang SAMA lagi → bukti idempotency consumer.
 *
 * Jalankan: pnpm --filter @mlv/api demo:cascade
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { EventBusService } from '../src/event-bus/event-bus.service';
import { OrderService } from '../src/domains/order/services/order.service';
import { prisma } from '@mlv/db';
import { ActorType } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { EVENT_NAMES, ALL_QUEUES, QUEUES } from '@mlv/types';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function line(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function queueSnapshot(queues: Record<string, Queue>) {
  const rows: Record<string, any> = {};
  for (const name of ALL_QUEUES) {
    const q = queues[name];
    const counts = await q.getJobCounts('completed', 'failed', 'active', 'waiting', 'delayed');
    rows[name] = counts;
  }
  console.table(rows);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  await app.init();

  const eventBus = app.get(EventBusService);
  const orderService = app.get(OrderService);

  const queues: Record<string, Queue> = {};
  for (const name of ALL_QUEUES) {
    queues[name] = app.get<Queue>(getQueueToken(name));
  }

  // Bersihkan queue supaya hitungan demo bersih (tidak menyentuh data domain).
  line('0. Bersihkan queue (obliterate) untuk hitungan demo yang bersih');
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
  line('1. Siapkan data: order Kaos + service sablon → checkout → payment DP');
  const customer = await prisma.customer.findFirst();
  if (!customer) throw new Error('Tidak ada customer seeded. Jalankan seed dulu.');
  console.log(`Customer: ${customer.nama} (${customer.id})`);

  const created = await orderService.createOrder({ customerId: customer.id }, actor);
  console.log(`Order dibuat: ${created.orderNumber} (status ${created.status})`);

  await orderService.addOrderItem(
    created.id,
    { productType: 'Kaos', basePriceSnapshot: 75000, sizes: [{ ukuran: 'L', qty: 10 }] } as any,
    actor,
  );
  // Ambil itemId
  const orderWithItem = await prisma.order.findUnique({
    where: { id: created.id },
    include: { items: true },
  });
  const itemId = orderWithItem!.items[0].id;
  await orderService.addOrderService(
    created.id,
    itemId,
    { serviceType: 'Sablon DTG', tarif: 15000 } as any,
    actor,
  );
  console.log('Item Kaos + service Sablon DTG ditambahkan (routing akan sertakan PRINTING)');

  // Checkout: DRAFT → MENUNGGU_PEMBAYARAN_DP (reservasi stok atomik)
  await orderService.updateStatus(created.id, { status: 'MENUNGGU_PEMBAYARAN_DP' } as any, actor);
  const afterCheckout = await prisma.order.findUnique({ where: { id: created.id } });
  console.log(`Setelah checkout: status ${afterCheckout!.status}`);

  // Buat payment DP (record) — persis seperti createPayment (tanpa Midtrans call)
  const payment = await prisma.payment.create({
    data: {
      orderId: created.id,
      jenis: 'DP',
      metode: 'demo',
      jumlah: 300000,
      status: 'SUCCESS',
      webhookEventId: `demo-${Date.now()}`,
    },
  });
  console.log(`Payment DP dibuat: ${payment.id} (Rp ${payment.jumlah.toLocaleString()})`);

  // ------------------------------------------------------------------
  line('2. PUBLISH PaymentSucceeded (yang dilakukan webhook Midtrans)');
  // Payload lengkap (Fase 8): customerNama + customerNoHp agar Notification
  // (proses terpisah) bisa render template WA tanpa memanggil balik.
  const paymentEvent = {
    paymentId: payment.id,
    orderId: created.id,
    jenis: 'DP' as const,
    jumlah: payment.jumlah,
    customerId: customer.id,
    orderNumber: created.orderNumber,
    customerNama: customer.nama,
    customerNoHp: customer.noHp,
  };
  await eventBus.publish(EVENT_NAMES.PaymentSucceeded, paymentEvent);
  console.log('PaymentSucceeded dipublish → queue [order-events, notification-events]');

  console.log('\nMenunggu cascade diproses (order → OrderConfirmed → production/inventory)...');
  await sleep(4000);

  // ------------------------------------------------------------------
  line('3. Hasil cascade (dibaca dari state DB)');
  const orderAfter = await prisma.order.findUnique({
    where: { id: created.id },
    include: {
      timeline: { orderBy: { createdAt: 'asc' } },
      items: { include: { productionTasks: { orderBy: { sequence: 'asc' } } } },
    },
  });
  console.log(`Order status: ${orderAfter!.status}  (harusnya ANTREAN setelah DP)`);
  console.log('\nProduction tasks (dibuat via OrderConfirmed → production-events):');
  for (const item of orderAfter!.items) {
    for (const t of item.productionTasks) {
      console.log(`  #${t.sequence} ${t.taskType.padEnd(10)} status=${t.status}`);
    }
  }
  console.log('\nTimeline events:');
  for (const t of orderAfter!.timeline) {
    console.log(`  - ${t.tipeEvent}: ${t.deskripsi}`);
  }

  line('4. Hitungan job per queue (bukti job berpindah antar queue)');
  await queueSnapshot(queues);
  console.log(
    'finance-events(0) → PaymentSucceeded masuk order-events → OrderConfirmed masuk\n' +
      'production-events + inventory-events + notification-events. Cek juga log\n' +
      'proses services/notification untuk bukti lintas proses.',
  );

  // ------------------------------------------------------------------
  line('5. BUKTI IDEMPOTENCY — publish PaymentSucceeded yang SAMA lagi');
  const timelineCountBefore = orderAfter!.timeline.length;
  const taskCountBefore = orderAfter!.items.reduce((s, i) => s + i.productionTasks.length, 0);
  console.log(
    `Sebelum re-publish: status=${orderAfter!.status}, timeline=${timelineCountBefore}, tasks=${taskCountBefore}`,
  );

  await eventBus.publish(EVENT_NAMES.PaymentSucceeded, paymentEvent);
  await eventBus.publish(EVENT_NAMES.OrderConfirmed, {
    orderId: created.id,
    orderNumber: created.orderNumber,
    customerId: customer.id,
    confirmedAt: new Date(),
  });
  console.log('PaymentSucceeded + OrderConfirmed (duplikat) dipublish. Menunggu...');
  await sleep(4000);

  const orderDup = await prisma.order.findUnique({
    where: { id: created.id },
    include: {
      timeline: true,
      items: { include: { productionTasks: true } },
    },
  });
  const timelineCountAfter = orderDup!.timeline.length;
  const taskCountAfter = orderDup!.items.reduce((s, i) => s + i.productionTasks.length, 0);
  console.log(
    `Sesudah re-publish: status=${orderDup!.status}, timeline=${timelineCountAfter}, tasks=${taskCountAfter}`,
  );

  const idempotent =
    orderDup!.status === 'ANTREAN' &&
    timelineCountAfter === timelineCountBefore &&
    taskCountAfter === taskCountBefore;
  console.log(
    idempotent
      ? '✅ IDEMPOTEN: status/timeline/tasks TIDAK berubah — efek hanya sekali.'
      : '❌ TIDAK idempoten: ada perubahan tak terduga.',
  );

  line('SELESAI');
  console.log(
    'Cleanup data demo (order/payment) — queue dibiarkan agar bisa diinspeksi di Bull Board.',
  );
  await prisma.orderTimelineEvent.deleteMany({ where: { orderId: created.id } });
  for (const item of orderDup!.items) {
    await prisma.productionTask.deleteMany({ where: { orderItemId: item.id } });
  }
  await prisma.stockReservation.deleteMany({ where: { orderId: created.id } });
  await prisma.payment.deleteMany({ where: { orderId: created.id } });
  await prisma.orderMaterial.deleteMany({
    where: { orderItem: { orderId: created.id } },
  });
  await prisma.orderService.deleteMany({ where: { orderItem: { orderId: created.id } } });
  await prisma.orderSize.deleteMany({ where: { orderItem: { orderId: created.id } } });
  await prisma.orderItem.deleteMany({ where: { orderId: created.id } });
  await prisma.order.delete({ where: { id: created.id } });
  console.log('Data demo dibersihkan.');

  await app.close();
  await prisma.$disconnect();
  process.exit(idempotent ? 0 : 1);
}

main().catch(async (err) => {
  console.error('DEMO GAGAL:', err);
  process.exit(1);
});
