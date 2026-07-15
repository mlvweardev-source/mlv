/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO AUTH PORTAL — Fase 9 Bagian 1 (Identity & Access: refresh token + cookie)
 *
 * Membuktikan lewat HTTP sungguhan (bukan panggilan service langsung):
 *  1. LOGIN      : POST /auth/login → Set-Cookie httpOnly access+refresh;
 *                  body TIDAK berisi token (hanya info user).
 *  2. COOKIE AUTH: GET /auth/me & GET /orders dengan cookie → 200;
 *                  tanpa cookie → 401.
 *  3. RBAC §5.1  : Tim Penjahit GET /orders → hanya order dengan task miliknya;
 *                  Tim Penjahit buka order lain → 403;
 *                  PATCH /orders/:id/status oleh Penjahit → ditolak.
 *  4. REFRESH    : access token kadaluarsa (simulasi expired) → POST /auth/refresh
 *                  dengan refresh token cookie → access token BARU + rotasi
 *                  refresh token (token lama di-revoke di DB).
 *  5. LOGOUT     : POST /auth/logout → cookie di-clear + refresh token revoked;
 *                  refresh dengan token ter-revoke → 401 (dan reuse detection).
 *
 * Jalankan: pnpm --filter @mlv/api demo:auth-portal
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { signJwt, ActorType, UserRole } from '@mlv/auth';

const DEMO_PORT = 3998;
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

/** Parse Set-Cookie headers → { name: value } (hanya pair pertama tiap cookie). */
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

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(DEMO_PORT);

  // ---- Seed data demo: 2 order; 1 punya task milik penjahit ----
  const owner = await prisma.user.findUnique({ where: { email: 'owner@mlv.dev' } });
  const penjahit = await prisma.user.findUnique({ where: { email: 'penjahit@mlv.dev' } });
  const customer = await prisma.customer.findFirst();
  if (!owner || !penjahit || !customer) {
    console.error('Seed dasar tidak ditemukan — jalankan `pnpm --filter @mlv/db db:seed` dulu.');
    process.exit(1);
  }

  const orderMilikPenjahit = await prisma.order.create({
    data: {
      orderNumber: `DEMO-AUTH-${Date.now()}-1`,
      customerId: customer.id,
      status: 'ANTREAN',
      items: { create: { productType: 'Kaos', basePriceSnapshot: 100000 } },
    },
    include: { items: true },
  });
  const orderLain = await prisma.order.create({
    data: {
      orderNumber: `DEMO-AUTH-${Date.now()}-2`,
      customerId: customer.id,
      status: 'ANTREAN',
      items: { create: { productType: 'Kemeja', basePriceSnapshot: 150000 } },
    },
  });
  const demoTask = await prisma.productionTask.create({
    data: {
      orderItemId: orderMilikPenjahit.items[0].id,
      taskType: 'SEWING',
      sequence: 1,
      status: 'SEDANG_DILAKSANAKAN',
      assignedTo: penjahit.id,
    },
  });

  try {
    // ================================================================
    line('1. LOGIN — cookie httpOnly di-set, token TIDAK ada di body');
    // ================================================================
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@mlv.dev', password: 'owner123' }),
    });
    const loginBody = await loginRes.json();
    const ownerCookies = parseCookies(loginRes);

    check('Login Owner sukses', loginRes.ok, `status=${loginRes.status}`);
    check(
      'Set-Cookie access token (httpOnly)',
      !!ownerCookies['mlv_access_token'] &&
        loginRes.headers
          .getSetCookie()
          .some((c) => c.startsWith('mlv_access_token=') && /httponly/i.test(c)),
    );
    check(
      'Set-Cookie refresh token (httpOnly)',
      !!ownerCookies['mlv_refresh_token'] &&
        loginRes.headers
          .getSetCookie()
          .some((c) => c.startsWith('mlv_refresh_token=') && /httponly/i.test(c)),
    );
    check(
      'Body TIDAK berisi token (hanya user)',
      !('accessToken' in loginBody) && !('refreshToken' in loginBody) && !!loginBody.user,
      `keys=${Object.keys(loginBody).join(',')}`,
    );

    // ================================================================
    line('2. COOKIE AUTH — /auth/me & /orders pakai cookie; tanpa cookie 401');
    // ================================================================
    const meRes = await fetch(`${BASE}/auth/me`, {
      headers: { cookie: cookieHeader(ownerCookies) },
    });
    const meBody = await meRes.json();
    check('GET /auth/me via cookie 200', meRes.status === 200, `nama=${meBody.nama}`);

    const ordersRes = await fetch(`${BASE}/orders`, {
      headers: { cookie: cookieHeader(ownerCookies) },
    });
    const allOrders = await ordersRes.json();
    check(
      'GET /orders via cookie 200 (Owner lihat semua)',
      ordersRes.status === 200,
      `total=${Array.isArray(allOrders) ? allOrders.length : '?'}`,
    );

    const noCookieRes = await fetch(`${BASE}/orders`);
    check('GET /orders TANPA cookie → 401', noCookieRes.status === 401);

    // ================================================================
    line('3. RBAC §5.1 — Tim Penjahit view terbatas');
    // ================================================================
    const penjahitLogin = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'penjahit@mlv.dev', password: 'penjahit123' }),
    });
    const penjahitCookies = parseCookies(penjahitLogin);
    check('Login Penjahit sukses', penjahitLogin.ok, `status=${penjahitLogin.status}`);

    const penjahitOrdersRes = await fetch(`${BASE}/orders`, {
      headers: { cookie: cookieHeader(penjahitCookies) },
    });
    const penjahitOrders = await penjahitOrdersRes.json();
    const penjahit = await prisma.user.findUnique({ where: { email: 'penjahit@mlv.dev' } });
    const assignedTasks = await prisma.productionTask.findMany({
      where: { assignedTo: penjahit!.id },
      select: { orderItem: { select: { orderId: true } } },
    });
    const assignedOrderIds = [...new Set(assignedTasks.map((t) => t.orderItem.orderId))];
    check(
      'Penjahit GET /orders → HANYA order dengan task miliknya',
      penjahitOrdersRes.status === 200 &&
        Array.isArray(penjahitOrders) &&
        penjahitOrders.length === assignedOrderIds.length &&
        penjahitOrders.every((o: any) => assignedOrderIds.includes(o.id)),
      `dilihat=${penjahitOrders.length}, task miliknya di ${assignedOrderIds.length} order (Owner lihat ${allOrders.length})`,
    );

    // Penjahit buka order yang BUKAN miliknya → 403
    const foreignOrder = (allOrders as any[]).find((o) => !assignedOrderIds.includes(o.id));
    if (foreignOrder) {
      const forbidden = await fetch(`${BASE}/orders/${foreignOrder.id}`, {
        headers: { cookie: cookieHeader(penjahitCookies) },
      });
      check(
        'Penjahit buka order orang lain → 403',
        forbidden.status === 403,
        `status=${forbidden.status}`,
      );
      const patchDenied = await fetch(`${BASE}/orders/${foreignOrder.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: cookieHeader(penjahitCookies) },
        body: JSON.stringify({ status: 'DIBATALKAN' }),
      });
      check(
        'Penjahit PATCH /orders/:id/status → ditolak (401/403)',
        patchDenied.status === 401 || patchDenied.status === 403,
        `status=${patchDenied.status}`,
      );
    } else {
      console.log('⚠️  Semua order punya task penjahit — skip test 403 (data seed)');
    }

    // ================================================================
    line('4. REFRESH — access expired → auto-refresh + rotasi refresh token');
    // ================================================================
    // Simulasi access token EXPIRED (exp = -1 detik) — refresh token masih valid
    const expiredAccess = signJwt(
      {
        sub: meBody.id,
        actorType: ActorType.USER,
        role: UserRole.OWNER,
        email: 'owner@mlv.dev',
      },
      process.env.JWT_SECRET!,
      '-1s',
    );
    const expiredRes = await fetch(`${BASE}/orders`, {
      headers: { cookie: `mlv_access_token=${expiredAccess}` },
    });
    check('Access token expired → 401', expiredRes.status === 401);

    // Tunggu >1 detik supaya iat/exp JWT baru pasti beda dari yang lama
    await new Promise((r) => setTimeout(r, 1100));

    const refreshRes = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `mlv_refresh_token=${ownerCookies['mlv_refresh_token']}` },
    });
    const refreshedCookies = parseCookies(refreshRes);
    check(
      'POST /auth/refresh sukses (tanpa login ulang)',
      refreshRes.ok,
      `status=${refreshRes.status}`,
    );
    check(
      'Access token BARU di-set',
      !!refreshedCookies['mlv_access_token'] &&
        refreshedCookies['mlv_access_token'] !== ownerCookies['mlv_access_token'],
    );
    check(
      'Refresh token DIROTASI (beda dari yang lama)',
      !!refreshedCookies['mlv_refresh_token'] &&
        refreshedCookies['mlv_refresh_token'] !== ownerCookies['mlv_refresh_token'],
    );

    const newAccessWorks = await fetch(`${BASE}/orders`, {
      headers: { cookie: `mlv_access_token=${refreshedCookies['mlv_access_token']}` },
    });
    check('Access token baru bisa akses /orders', newAccessWorks.status === 200);

    // Reuse refresh token LAMA (sudah dirotasi) → 401 + revoke semua sesi
    const reuseRes = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `mlv_refresh_token=${ownerCookies['mlv_refresh_token']}` },
    });
    check('Reuse refresh token lama → 401 (deteksi pencurian)', reuseRes.status === 401);

    // ================================================================
    line('5. LOGOUT — revoke + clear cookie; akses ditolak setelahnya');
    // ================================================================
    // Login ulang dulu (sesi owner tadi ter-revoke oleh reuse detection)
    const relogin = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@mlv.dev', password: 'owner123' }),
    });
    const sessionCookies = parseCookies(relogin);

    const logoutRes = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookieHeader(sessionCookies) },
    });
    check('POST /auth/logout sukses', logoutRes.ok, `status=${logoutRes.status}`);
    const clearedCookies = logoutRes.headers.getSetCookie();
    check(
      'Cookie di-clear (Set-Cookie kosong/expired)',
      clearedCookies.some(
        (c) => c.startsWith('mlv_access_token=;') || /expires=thu, 01 jan 1970/i.test(c),
      ),
    );

    const refreshAfterLogout = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `mlv_refresh_token=${sessionCookies['mlv_refresh_token']}` },
    });
    check('Refresh setelah logout → 401 (token revoked di DB)', refreshAfterLogout.status === 401);

    // ================================================================
    line(failures === 0 ? '🎉 SEMUA BUKTI LULUS' : `❌ ${failures} BUKTI GAGAL`);
    // ================================================================
  } finally {
    // Bersihkan data demo
    await prisma.productionTask.delete({ where: { id: demoTask.id } }).catch(() => null);
    await prisma.order
      .deleteMany({ where: { id: { in: [orderMilikPenjahit.id, orderLain.id] } } })
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
