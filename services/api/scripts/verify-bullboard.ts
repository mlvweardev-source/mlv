/**
 * VERIFIKASI BULL BOARD — Fase 6 (§22)
 *
 * Boot API penuh (NestFactory.create → HTTP listen), lalu cek:
 *  1. GET /admin/queues TANPA auth   → 401 (payload job sensitif, wajib auth)
 *  2. GET /admin/queues password salah → 401
 *  3. GET /admin/queues dengan Basic Auth benar → 200
 *  4. GET /admin/queues/api/queues → daftar 5 queue + job counts
 *
 * Jalankan: pnpm --filter @mlv/api verify:bullboard
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { setupBullBoard } from '../src/event-bus/bull-board.setup';

async function get(path: string, auth?: string): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {};
  if (auth) headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
  const res = await fetch(`http://localhost:3000${path}`, { headers });
  const body = await res.text();
  return { status: res.status, body };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  setupBullBoard(app);
  await app.listen(3000);
  console.log('API listening on :3000 (Bull Board mounted at /admin/queues)\n');

  const user = process.env.BULL_BOARD_USER || 'admin';
  const pass = process.env.BULL_BOARD_PASSWORD || '';

  const noAuth = await get('/admin/queues');
  console.log(
    `1. Tanpa auth        → ${noAuth.status} ${noAuth.status === 401 ? '✅ (ditolak)' : '❌ HARUSNYA 401'}`,
  );

  const wrongPass = await get('/admin/queues', `${user}:password-salah`);
  console.log(
    `2. Password salah    → ${wrongPass.status} ${wrongPass.status === 401 ? '✅ (ditolak)' : '❌ HARUSNYA 401'}`,
  );

  const okAuth = await get('/admin/queues', `${user}:${pass}`);
  console.log(
    `3. Basic Auth benar  → ${okAuth.status} ${okAuth.status === 200 ? '✅ (Bull Board UI)' : '❌ HARUSNYA 200'}`,
  );

  const api = await get('/admin/queues/api/queues', `${user}:${pass}`);
  console.log(`4. API queues        → ${api.status}`);
  try {
    const data = JSON.parse(api.body);
    const queues = (data.queues ?? []).map(
      (q: { name: string; counts: Record<string, number> }) => ({
        name: q.name,
        completed: q.counts?.completed,
        failed: q.counts?.failed,
        waiting: q.counts?.waiting,
      }),
    );
    console.table(queues);
  } catch {
    console.log(api.body.slice(0, 300));
  }

  const allOk = noAuth.status === 401 && wrongPass.status === 401 && okAuth.status === 200;
  console.log(
    allOk ? '\n✅ Bull Board aman: tanpa auth ditolak, dengan auth OK.' : '\n❌ Ada yang salah.',
  );

  await app.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('VERIFIKASI GAGAL:', err);
  process.exit(1);
});
