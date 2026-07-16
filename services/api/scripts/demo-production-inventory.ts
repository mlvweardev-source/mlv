/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO PRODUCTION & INVENTORY — Fase 9 Bagian 2
 *
 * Membuktikan lewat HTTP sungguhan (bukan panggilan service langsung):
 *  1. KANBAN     : GET /production/tasks (Manajer) → task tersebar di beberapa
 *                  kolom (taskType); PATCH satu task → SELESAI → task
 *                  berikutnya otomatis DITERIMA (kartu pindah kolom).
 *  2. ASSIGN     : POST /production/tasks/:id/assign (Manajer) → task
 *                  ditugaskan ke Tim Penjahit.
 *  3. TABEL PENJAHIT: login Tim Penjahit → GET /production/tasks → HANYA task
 *                  miliknya; PATCH task milik orang lain → 403.
 *  4. PURCHASE ORDER: POST /purchases → PATCH /purchases/:id/complete →
 *                  stock_balances.qty_available BENAR-BENAR bertambah +
 *                  stock_movements tipe IN tercatat (bukan cuma flip status);
 *                  complete kedua kali → 400 (idempoten).
 *  5. RBAC §5.1  : Penjahit POST /materials → ditolak; Penjahit GET
 *                  /stock/balance → boleh (view-only).
 *
 * Jalankan: pnpm --filter @mlv/api demo:production-inventory
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';

const DEMO_PORT = 3997;
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

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(DEMO_PORT);

  // ---- Seed data demo ----
  const penjahit = await prisma.user.findUnique({ where: { email: 'penjahit@mlv.dev' } });
  const customer = await prisma.customer.findFirst();
  const kain = await prisma.material.findFirst({ where: { nama: 'Kain' } });
  const warehouse = await prisma.warehouse.findFirst();
  if (!penjahit || !customer || !kain || !warehouse) {
    console.error('Seed dasar tidak ditemukan — jalankan `pnpm --filter @mlv/db db:seed` dulu.');
    process.exit(1);
  }

  // Order 1 (Kaos): 3 task tersebar di 3 kolom — CUTTING selesai akan
  // memicu SEWING → DITERIMA (kartu pindah kolom di kanban).
  const order1 = await prisma.order.create({
    data: {
      orderNumber: `DEMO-PROD-${Date.now()}-1`,
      customerId: customer.id,
      status: 'ANTREAN',
      items: { create: { productType: 'Kaos', basePriceSnapshot: 100000 } },
    },
    include: { items: true },
  });
  const item1 = order1.items[0];
  const taskCutting = await prisma.productionTask.create({
    data: { orderItemId: item1.id, taskType: 'CUTTING', sequence: 1, status: 'DITERIMA' },
  });
  const taskSewing = await prisma.productionTask.create({
    data: { orderItemId: item1.id, taskType: 'SEWING', sequence: 2, status: 'MENUNGGU' },
  });
  const taskPacking = await prisma.productionTask.create({
    data: { orderItemId: item1.id, taskType: 'PACKING', sequence: 3, status: 'MENUNGGU' },
  });

  // Order 2 (Kemeja): task milik penjahit lain (bukti filter Tim Penjahit)
  const order2 = await prisma.order.create({
    data: {
      orderNumber: `DEMO-PROD-${Date.now()}-2`,
      customerId: customer.id,
      status: 'ANTREAN',
      items: { create: { productType: 'Kemeja', basePriceSnapshot: 150000 } },
    },
    include: { items: true },
  });
  const taskOrangLain = await prisma.productionTask.create({
    data: {
      orderItemId: order2.items[0].id,
      taskType: 'FINISHING',
      sequence: 1,
      status: 'DITERIMA',
    },
  });

  const demoTaskIds = [taskCutting.id, taskSewing.id, taskPacking.id, taskOrangLain.id];
  let demoPoId: string | null = null;

  try {
    const manajerCookies = await login('manajer@mlv.dev', 'manajer123');
    const penjahitCookies = await login('penjahit@mlv.dev', 'penjahit123');

    // ================================================================
    line('1. KANBAN MANAJER — task tersebar di kolom; update → kartu pindah');
    // ================================================================
    const tasksRes = await fetch(`${BASE}/production/tasks`, {
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const allTasks = (await tasksRes.json()) as any[];
    const demoTasks = allTasks.filter((t: any) => demoTaskIds.includes(t.id));
    const kolom = new Set(demoTasks.map((t: any) => t.taskType));
    check(
      'GET /production/tasks (Manajer) → task demo tersebar di beberapa kolom',
      tasksRes.status === 200 && kolom.size >= 3,
      `kolom terisi: ${[...kolom].join(', ')}`,
    );

    // Manajer tandai CUTTING selesai → SEWING otomatis DITERIMA
    const completeRes = await fetch(`${BASE}/production/tasks/${taskCutting.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({ status: 'SELESAI' }),
    });
    check('PATCH task CUTTING → SELESAI', completeRes.status === 200);

    const sewingAfter = await prisma.productionTask.findUnique({ where: { id: taskSewing.id } });
    check(
      'Task SEWING otomatis DITERIMA (kartu pindah dari Menunggu → Siap Dikerjakan)',
      sewingAfter?.status === 'DITERIMA',
      `status=${sewingAfter?.status}`,
    );

    // ================================================================
    line('2. ASSIGN — Manajer tugaskan task SEWING ke Tim Penjahit');
    // ================================================================
    const assignRes = await fetch(`${BASE}/production/tasks/${taskSewing.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({ userId: penjahit.id }),
    });
    const assignedTask = (await assignRes.json()) as any;
    check(
      'POST /production/tasks/:id/assign → ditugaskan ke penjahit',
      assignRes.status === 201 && assignedTask.assignedTo === penjahit.id,
      `assignedTo=${assignedTask.assignedToUser?.nama}`,
    );

    // ================================================================
    line('3. TABEL TIM PENJAHIT — hanya task miliknya; task orang lain ditolak');
    // ================================================================
    const penjahitTasksRes = await fetch(`${BASE}/production/tasks`, {
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    const penjahitTasks = (await penjahitTasksRes.json()) as any[];
    check(
      'GET /production/tasks (Penjahit) → SEMUA task = miliknya',
      penjahitTasksRes.status === 200 &&
        penjahitTasks.length > 0 &&
        penjahitTasks.every((t: any) => t.assignedTo === penjahit.id),
      `dilihat=${penjahitTasks.length} task, semua assignedTo dirinya (Manajer lihat ${allTasks.length})`,
    );
    check(
      'Task orang lain TIDAK muncul di tabel penjahit',
      !penjahitTasks.some((t: any) => t.id === taskOrangLain.id),
    );

    // Penjahit update task MILIKNYA → boleh
    const ownUpdateRes = await fetch(`${BASE}/production/tasks/${taskSewing.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(penjahitCookies) },
      body: JSON.stringify({ status: 'SELESAI' }),
    });
    check('Penjahit PATCH task miliknya → 200', ownUpdateRes.status === 200);

    // Penjahit update task ORANG LAIN → 403
    const foreignUpdateRes = await fetch(`${BASE}/production/tasks/${taskOrangLain.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(penjahitCookies) },
      body: JSON.stringify({ status: 'SEDANG_DILAKSANAKAN' }),
    });
    check('Penjahit PATCH task orang lain → 403', foreignUpdateRes.status === 403);

    // ================================================================
    line('4. PURCHASE ORDER — tandai diterima = stok NYATA bertambah');
    // ================================================================
    const balanceBefore = await prisma.stockBalance.findUnique({
      where: {
        materialId_warehouseId: { materialId: kain.id, warehouseId: warehouse.id },
      },
    });
    const qtyBefore = balanceBefore?.qtyAvailable ?? 0;

    const createPoRes = await fetch(`${BASE}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(manajerCookies) },
      body: JSON.stringify({
        supplier: 'Toko Kain Demo',
        materialId: kain.id,
        qty: 25,
        totalBiaya: 750000,
        tglBeli: new Date().toISOString(),
      }),
    });
    const po = (await createPoRes.json()) as any;
    demoPoId = po.id;
    check(
      'POST /purchases → PO baru status PENDING',
      createPoRes.status === 201 && po.status === 'PENDING',
      `supplier=${po.supplier}, qty=25 meter Kain`,
    );

    const completePoRes = await fetch(`${BASE}/purchases/${po.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const completedPo = (await completePoRes.json()) as any;
    check(
      'PATCH /purchases/:id/complete → status COMPLETED',
      completePoRes.status === 200 && completedPo.status === 'COMPLETED',
    );

    const balanceAfter = await prisma.stockBalance.findUnique({
      where: {
        materialId_warehouseId: { materialId: kain.id, warehouseId: warehouse.id },
      },
    });
    check(
      'BUKTI STOK NYATA: stock_balances.qty_available bertambah 25',
      (balanceAfter?.qtyAvailable ?? 0) === qtyBefore + 25,
      `sebelum=${qtyBefore}, sesudah=${balanceAfter?.qtyAvailable}`,
    );

    const movementIn = await prisma.stockMovement.findFirst({
      where: { refType: 'purchase_order', refId: po.id, tipe: 'IN' },
    });
    check(
      'stock_movements tipe IN tercatat (sumber kebenaran)',
      !!movementIn && movementIn.qty === 25,
      `movement id=${movementIn?.id}`,
    );

    // Idempoten: complete kedua kali → 400, stok TIDAK bertambah lagi
    const doubleCompleteRes = await fetch(`${BASE}/purchases/${po.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: cookieHeader(manajerCookies) },
    });
    const balanceAfterDouble = await prisma.stockBalance.findUnique({
      where: {
        materialId_warehouseId: { materialId: kain.id, warehouseId: warehouse.id },
      },
    });
    check(
      'Complete kedua kali → 400 + stok TIDAK bertambah dobel',
      doubleCompleteRes.status === 400 &&
        (balanceAfterDouble?.qtyAvailable ?? 0) === qtyBefore + 25,
      `status=${doubleCompleteRes.status}, qty tetap ${balanceAfterDouble?.qtyAvailable}`,
    );

    // ================================================================
    line('5. RBAC §5.1 — Penjahit view-only di Inventory');
    // ================================================================
    const penjahitCreateMaterial = await fetch(`${BASE}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader(penjahitCookies) },
      body: JSON.stringify({ nama: 'Ilegal', satuan: 'pcs', kategori: 'x' }),
    });
    check(
      'Penjahit POST /materials → ditolak (401/403)',
      penjahitCreateMaterial.status === 401 || penjahitCreateMaterial.status === 403,
      `status=${penjahitCreateMaterial.status}`,
    );

    const penjahitViewStock = await fetch(`${BASE}/stock/balance`, {
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    check('Penjahit GET /stock/balance → boleh (view-only)', penjahitViewStock.status === 200);

    const penjahitCompletePo = await fetch(`${BASE}/purchases/${po.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    check(
      'Penjahit PATCH /purchases/:id/complete → ditolak (401/403)',
      penjahitCompletePo.status === 401 || penjahitCompletePo.status === 403,
      `status=${penjahitCompletePo.status}`,
    );

    // ================================================================
    line(failures === 0 ? '🎉 SEMUA BUKTI LULUS' : `❌ ${failures} BUKTI GAGAL`);
    // ================================================================
  } finally {
    // Bersihkan data demo (movement IN dibiarkan? tidak — hapus + koreksi balance)
    if (demoPoId) {
      const movement = await prisma.stockMovement.findFirst({
        where: { refType: 'purchase_order', refId: demoPoId, tipe: 'IN' },
      });
      if (movement) {
        // Kembalikan balance seperti semula supaya demo bisa diulang bersih
        await prisma.stockBalance.update({
          where: {
            materialId_warehouseId: {
              materialId: movement.materialId,
              warehouseId: movement.warehouseId,
            },
          },
          data: { qtyAvailable: { decrement: movement.qty } },
        });
        await prisma.stockMovement.delete({ where: { id: movement.id } }).catch(() => null);
      }
      await prisma.purchaseOrder.delete({ where: { id: demoPoId } }).catch(() => null);
    }
    await prisma.productionTask.deleteMany({ where: { id: { in: demoTaskIds } } });
    await prisma.order
      .deleteMany({ where: { id: { in: [order1.id, order2.id] } } })
      .catch(() => null);
    await app.close();
    await prisma.$disconnect();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
