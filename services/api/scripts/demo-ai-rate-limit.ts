/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DEMO AI RATE LIMIT — Fase 12 Bagian 1
 *
 * Membuktikan: request ke-51 dalam 1 jam ditolak dengan 429.
 * Menggunakan ai-gateway yang sedang berjalan.
 *
 * Jalankan: pnpm --filter @mlv/api demo:ai-rate-limit
 *
 * CATATAN: Pastikan services/ai-gateway berjalan di port 3002
 * dan Redis berjalan di localhost:6379.
 */

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'http://localhost:3002';
const CUSTOMER_ID = `demo-rate-limit-${Date.now()}`;

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

async function sendRequest(requestNum: number): Promise<{ status: number; body: any }> {
  try {
    const response = await fetch(`${AI_GATEWAY_URL}/ai/design-analyzer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-ID': CUSTOMER_ID,
      },
      body: JSON.stringify({
        catatanTeks: `Test request #${requestNum}`,
        productType: 'Kaos',
      }),
    });

    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch (error: any) {
    return { status: 0, body: { error: error.message } };
  }
}

async function main() {
  line('DEMO AI RATE LIMIT — 51st REQUEST DITOLAK');
  console.log(`Customer ID: ${CUSTOMER_ID}`);
  console.log(`AI Gateway: ${AI_GATEWAY_URL}`);

  // =========================================
  // 1. Verify AI gateway is running
  // =========================================
  line('1. CEK AI GATEWAY BERJALAN');

  try {
    const health = await fetch(`${AI_GATEWAY_URL}/health`);
    check('AI gateway health check', health.ok, `status=${health.status}`);
  } catch (error: any) {
    console.log(`❌ AI gateway tidak berjalan: ${error.message}`);
    console.log('   Jalankan: pnpm --filter @mlv/ai-gateway dev');
    return;
  }

  // =========================================
  // 2. Send 50 requests (within limit)
  // =========================================
  line('2. KIRIM 50 REQUEST (DALAM BATAS)');

  let rateLimitedAt = -1;

  for (let i = 1; i <= 50; i++) {
    const { status } = await sendRequest(i);

    if (status === 429) {
      rateLimitedAt = i;
      check(`Request #${i}`, false, `unexpected 429 (should be within limit)`);
      break;
    }

    // We don't care about 200 vs 500 here — the important thing is no 429
    if (i === 1) {
      console.log(`  ℹ️  First request status: ${status}`);
    }
    if (i % 10 === 0) {
      console.log(`  ℹ️  Request #${i}: status=${status}`);
    }
  }

  if (rateLimitedAt === -1) {
    check('All 50 requests within limit', true, 'no 429 received');
  }

  // =========================================
  // 3. Send 51st request (should be rejected)
  // =========================================
  line('3. KIRIM REQUEST KE-51 (HARUS DITOLAK)');

  const { status: status51, body: body51 } = await sendRequest(51);

  check('Request #51 returned 429', status51 === 429, `status=${status51}`);

  if (status51 === 429) {
    check(
      'Response contains retry message',
      typeof body51?.message === 'string' && body51.message.includes('Batas permintaan'),
      `message=${body51?.message}`,
    );
  }

  // =========================================
  // 4. Verify rate limit headers
  // =========================================
  line('4. VERIFIKASI RATE LIMIT HEADERS');

  try {
    const response = await fetch(`${AI_GATEWAY_URL}/ai/design-analyzer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-ID': CUSTOMER_ID,
      },
      body: JSON.stringify({
        catatanTeks: 'Header check',
        productType: 'Kaos',
      }),
    });

    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');

    check('X-RateLimit-Limit header present', !!limit, `value=${limit}`);
    check('X-RateLimit-Remaining header present', !!remaining, `value=${remaining}`);
    check('X-RateLimit-Reset header present', !!reset, `value=${reset}`);
  } catch (error: any) {
    check('Headers check', false, error.message);
  }

  // =========================================
  // 5. Summary
  // =========================================
  line('DEMO AI RATE LIMIT SELESAI');
  console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures} failure(s)`);

  if (failures === 0) {
    console.log('\nKesimpulan:');
    console.log('  - 50 request pertama: diterima (200/500 tergantung Gemini API key)');
    console.log('  - Request ke-51: ditolak dengan 429');
    console.log('  - Response berisi pesan "Batas permintaan AI tercapai"');
    console.log('  - Rate limit headers terkirim');
  }
}

main().catch((e) => {
  console.error('❌ Demo failed:', e);
  process.exit(1);
});
