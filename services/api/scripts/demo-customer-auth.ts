/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO CUSTOMER AUTH — Fase 10 Bagian 1
 *
 * Membuktikan:
 *  1. OTP TIDAK lagi di-console.log (mock Fase 1 dicabut): request OTP
 *     mem-publish `auth.otp.requested` → queue notification-events →
 *     proses services/notification mengirim via FonnteChannel (sandbox
 *     log jika FONNTE_API_TOKEN kosong) + notification_logs berisi
 *     pesan MASKED (kode tidak terbaca staff).
 *  2. Verifikasi OTP → sukses set httpOnly cookie `mlv_customer_token`
 *     (token TIDAK di response body) → GET /auth/me via cookie = sesi aktif.
 *  3. Google callback fail-closed: token palsu ditolak 401/503 — TIDAK
 *     ada fallback mock yang membuat akun dari token mentah.
 *  4. Proteksi: GET /auth/me tanpa cookie = 401.
 *
 * Prasyarat: Postgres + Redis hidup, `pnpm --filter @mlv/db db:seed`
 * sudah dijalankan (template auth.otp.requested), DAN proses
 * services/notification hidup (pnpm --filter @mlv/notification dev)
 * supaya bukti lintas proses terlihat di log worker.
 *
 * Jalankan: pnpm --filter @mlv/api demo:customer-auth
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { compareOtp } from '@mlv/auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function line(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

let passCount = 0;
let failCount = 0;
function check(desc: string, ok: boolean, extra = '') {
  if (ok) {
    passCount++;
    console.log(`  ✅ ${desc}${extra ? ` — ${extra}` : ''}`);
  } else {
    failCount++;
    console.log(`  ❌ ${desc}${extra ? ` — ${extra}` : ''}`);
  }
}

const PHONE = '089900112233'; // nomor demo khusus (bukan seed customer)
const BASE = `http://localhost:${process.env.DEMO_API_PORT ?? 3999}`;

async function main() {
  // Boot API lengkap di port demo (tidak bentrok dev server)
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(process.env.DEMO_API_PORT ?? 3999);

  // Bersihkan jejak demo sebelumnya supaya bukti deterministik
  await prisma.notificationLog.deleteMany({ where: { eventType: 'auth.otp.requested' } });
  await prisma.otpCode.deleteMany({ where: { phone: PHONE } });
  await prisma.customer.deleteMany({ where: { noHp: PHONE } });

  // ------------------------------------------------------------------
  line('1. POST /auth/otp/request — kode dikirim via event, BUKAN console.log');
  const reqRes = await fetch(`${BASE}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE }),
  });
  const reqBody = (await reqRes.json()) as any;
  check('Status 201', reqRes.status === 201, `status=${reqRes.status}`);
  check('Pesan menyebut WhatsApp', String(reqBody.message).includes('WhatsApp'), reqBody.message);

  // Tunggu worker notification (proses terpisah) mengonsumsi job
  console.log('  … menunggu 4s worker services/notification memproses job …');
  await sleep(4000);

  const log = await prisma.notificationLog.findFirst({
    where: { eventType: 'auth.otp.requested' },
    orderBy: { createdAt: 'desc' },
  });
  check('notification_log tercipta oleh proses notification', !!log);
  check('Status kirim SENT (Fonnte sandbox)', log?.statusKirim === 'SENT', log?.statusKirim);
  check('Channel WHATSAPP', log?.channel === 'WHATSAPP', log?.channel);
  check(
    'Kode OTP di log DI-MASK (staff tidak bisa baca kode)',
    !!log?.pesan.includes('******') && !/\b\d{6}\b/.test(log?.pesan ?? ''),
    log?.pesan,
  );

  // ------------------------------------------------------------------
  line('2. Verifikasi OTP → httpOnly cookie → GET /auth/me sesi aktif');
  // Demo mengambil kode dari DB via brute-force hash compare — HANYA
  // bisa dilakukan pemegang akses DB langsung, bukan lewat API.
  const otpRow = await prisma.otpCode.findFirst({
    where: { phone: PHONE, isUsed: false },
    orderBy: { createdAt: 'desc' },
  });
  check('otp_codes berisi hash (bukan plaintext)', !!otpRow && !/^\d{6}$/.test(otpRow.codeHash));

  // Ambil kode dari job BullMQ (bukti juga bahwa payload event membawa
  // kode — kontrak OtpRequestedPayload). Hanya bisa dilakukan pemegang
  // akses Redis langsung, bukan lewat API.
  const { Queue } = await import('bullmq');
  const q = new Queue('notification-events', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  });
  const jobs = await q.getJobs(['completed', 'waiting', 'active'], 0, 200);
  const otpJob = jobs
    .filter((j) => j.name === 'auth.otp.requested' && j.data?.customerNoHp === PHONE)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
  const realCode: string = otpJob?.data?.kode ?? '';
  check('Payload event berisi kode 6 digit', /^\d{6}$/.test(realCode));
  const matchesHash = otpRow ? await compareOtp(realCode, otpRow.codeHash) : false;
  check('Kode di event = kode yang di-hash ke DB', matchesHash);
  await q.close();

  const verifyRes = await fetch(`${BASE}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, code: realCode }),
  });
  const verifyBody = (await verifyRes.json()) as any;
  const setCookie = verifyRes.headers
    .getSetCookie()
    .find((c) => c.startsWith('mlv_customer_token='));
  check('Verify 201', verifyRes.status === 201, `status=${verifyRes.status}`);
  check('Set-Cookie mlv_customer_token (httpOnly)', !!setCookie?.includes('HttpOnly'));
  check('Token TIDAK ada di response body', !('accessToken' in verifyBody));
  check(
    'Akun customer otomatis ter-create',
    verifyBody.customer?.noHp === PHONE,
    `customerId=${verifyBody.customer?.id}`,
  );

  const authMethod = await prisma.customerAuthMethod.findFirst({
    where: { identifier: PHONE, tipe: 'OTP_HP' },
  });
  check('customer_auth_methods (OTP_HP) tercatat', !!authMethod);

  const cookieVal = setCookie!.split(';')[0];
  const meRes = await fetch(`${BASE}/auth/me`, { headers: { cookie: cookieVal } });
  const meBody = (await meRes.json()) as any;
  check('GET /auth/me via cookie = 200', meRes.status === 200);
  check('actorType CUSTOMER', meBody.actorType === 'CUSTOMER', meBody.actorType);

  const noCookie = await fetch(`${BASE}/auth/me`);
  check('GET /auth/me TANPA cookie = 401', noCookie.status === 401, `status=${noCookie.status}`);

  // ------------------------------------------------------------------
  line('3. Google callback — mock DICABUT, fail-closed');
  const customersBefore = await prisma.customer.count();
  const fakeRes = await fetch(`${BASE}/auth/google/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'obviously-not-a-real-google-id-token-1234567890' }),
  });
  check(
    'Token palsu DITOLAK (401 invalid / 503 belum dikonfigurasi), BUKAN membuat akun mock',
    fakeRes.status === 401 || fakeRes.status === 503,
    `status=${fakeRes.status}`,
  );
  const customersAfter = await prisma.customer.count();
  check(
    'Tidak ada customer baru tercipta dari token palsu',
    customersAfter === customersBefore,
    `count ${customersBefore} → ${customersAfter}`,
  );

  // ------------------------------------------------------------------
  line('HASIL');
  console.log(`  ${passCount} bukti lulus, ${failCount} gagal`);
  await app.close();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
