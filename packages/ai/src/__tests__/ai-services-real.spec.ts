import * as path from 'path';

// Load .env using Node's native process.loadEnvFile (Node 20.6+)
if (typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile(path.resolve(__dirname, '../../../../../../.env'));
  } catch (e) {
    // Gracefully handle missing .env
  }
}

import { GeminiClient } from '../gemini-client';
import {
  buildQuotationSystemPrompt,
  buildQuotationUserPrompt,
} from '../prompt-templates/quotation-assistant';
import {
  buildCustomerSupportSystemPrompt,
  buildCustomerSupportUserPrompt,
} from '../prompt-templates/customer-support';

/**
 * Real API test untuk Quotation Assistant & Customer Support.
 * Sama pola dengan gemini-client-real.spec.ts (Fase 12 Bagian 1).
 *
 * Skip jika GEMINI_API_KEY tidak set.
 * Jalankan manual: GEMINI_API_KEY=xxx pnpm --filter @mlv/ai test
 */
describe('GeminiClient — Quotation Assistant & Customer Support (Real API)', () => {
  let client: GeminiClient;
  let skipTests = false;

  beforeAll(() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('⏭️  Skipping AI real API tests for new services — GEMINI_API_KEY not set');
      skipTests = true;
      return;
    }
    client = new GeminiClient(apiKey, 'gemini-2.5-flash');
  });

  it('should return valid JSON price range for Quotation Assistant', async () => {
    if (skipTests) return;

    const systemPrompt = buildQuotationSystemPrompt();
    const userPrompt = buildQuotationUserPrompt({
      productType: 'Kaos',
      qty: 10,
      complexity: 'SEDANG',
      catatanStaf: 'Cotton combed 30s, sablon 4 warna, bordir logo dada',
      basePriceReference: 85000,
    });

    const result = await client.generate({
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      temperature: 0.3,
      maxOutputTokens: 1024,
    });

    let jsonText = result.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(jsonText);

    expect(parsed).toHaveProperty('harga_per_pcs');
    expect(parsed).toHaveProperty('total_estimasi');
    expect(parsed).toHaveProperty('alasan');
    expect(typeof parsed.harga_per_pcs.low).toBe('number');
    expect(typeof parsed.harga_per_pcs.high).toBe('number');
    expect(parsed.harga_per_pcs.low).toBeLessThanOrEqual(parsed.harga_per_pcs.high);
    expect(parsed.alasan.length).toBeGreaterThan(10);

    console.log(
      `✅ Quotation: Rp ${parsed.harga_per_pcs.low.toLocaleString('id-ID')}` +
        ` - Rp ${parsed.harga_per_pcs.high.toLocaleString('id-ID')} per pcs`,
    );
    console.log(`✅ Alasan: ${parsed.alasan.slice(0, 80)}...`);
  }, 30_000);

  it('should return canAnswer=true for in-context Customer Support question', async () => {
    if (skipTests) return;

    const orderContext = {
      orderNumber: 'MLV-20260719-0001',
      status: 'ANTREAN',
      items: [{ productType: 'Kaos', qty: 50, basePriceSnapshot: 85000 }],
      timeline: [
        {
          tipeEvent: 'DIBUAT',
          deskripsi: 'Order dibuat',
          createdAt: '2026-07-19T10:00:00Z',
        },
        {
          tipeEvent: 'CHECKOUT',
          deskripsi: 'Checkout berhasil. 4 material di-reserve.',
          createdAt: '2026-07-19T10:05:00Z',
        },
        {
          tipeEvent: 'ORDER_CONFIRMED',
          deskripsi: 'Pembayaran DP berhasil. Order masuk antrean produksi.',
          createdAt: '2026-07-19T10:30:00Z',
        },
      ],
      payments: [
        {
          jenis: 'DP' as const,
          jumlah: 2125000,
          status: 'SUCCESS',
          createdAt: '2026-07-19T10:30:00Z',
        },
      ],
      invoices: [{ jenis: 'DP' as const, jumlah: 2125000, status: 'PAID' }],
      shipment: null,
    };

    const systemPrompt = buildCustomerSupportSystemPrompt();
    const userPrompt = buildCustomerSupportUserPrompt({
      pertanyaan: 'Kapan pesanan saya selesai?',
      orderContext,
    });

    const result = await client.generate({
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      temperature: 0.5,
      maxOutputTokens: 512,
    });

    let jsonText = result.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(jsonText);

    expect(parsed).toHaveProperty('canAnswer');
    expect(typeof parsed.canAnswer).toBe('boolean');

    if (parsed.canAnswer) {
      expect(typeof parsed.jawaban).toBe('string');
      expect(parsed.jawaban.length).toBeGreaterThan(10);
      console.log(
        `✅ Customer Support (in-context): canAnswer=true, jawaban="${parsed.jawaban.slice(0, 80)}..."`,
      );
    } else {
      console.log(
        `ℹ️  Customer Support: AI escalated (canAnswer=false), reason="${parsed.alasan_eskalasi}"`,
      );
    }
  }, 30_000);

  it('should return canAnswer=false for out-of-context question (escalation)', async () => {
    if (skipTests) return;

    const orderContext = {
      orderNumber: 'MLV-20260719-0001',
      status: 'ANTREAN',
      items: [{ productType: 'Kaos', qty: 50, basePriceSnapshot: 85000 }],
      timeline: [],
      payments: [],
      invoices: [],
      shipment: null,
    };

    const systemPrompt = buildCustomerSupportSystemPrompt();
    const userPrompt = buildCustomerSupportUserPrompt({
      pertanyaan: 'Bisa minta diskon 30%? Saya pelanggan setia.',
      orderContext,
    });

    const result = await client.generate({
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      temperature: 0.5,
      maxOutputTokens: 512,
    });

    let jsonText = result.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(jsonText);

    expect(parsed).toHaveProperty('canAnswer');
    expect(parsed.canAnswer).toBe(false);
    expect(typeof parsed.alasan_eskalasi).toBe('string');
    expect(parsed.alasan_eskalasi.length).toBeGreaterThan(0);

    console.log(
      `✅ Customer Support (out-of-context): canAnswer=false, escalated — reason: "${parsed.alasan_eskalasi.slice(0, 80)}..."`,
    );
  }, 30_000);
});
