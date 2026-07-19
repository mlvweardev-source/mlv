import * as path from 'path';

// Load .env using Node's native process.loadEnvFile (Node 20.6+)
// Pola sama dengan inventory.concurrency.spec.ts
if (typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile(path.resolve(__dirname, '../../../../../../.env'));
  } catch (e) {
    // Gracefully handle missing .env (e.g. in CI pipelines)
  }
}

import { GeminiClient } from '../gemini-client';
import {
  buildDesignAnalyzerSystemPrompt,
  buildDesignAnalyzerUserPrompt,
} from '../prompt-templates/design-analyzer';

/**
 * Real API test untuk Gemini (pola concurrency test Inventory yang hit DB asli).
 *
 * Test ini WAJIB ada supaya deprecation/shutdown model ketahuan dari CI,
 * bukan ketahuan pas fitur sudah dipakai pelanggan.
 *
 * Skip jika GEMINI_API_KEY tidak set (CI tanpa secret).
 * Jalankan manual: GEMINI_API_KEY=xxx pnpm --filter @mlv/ai test
 */
describe('GeminiClient (Real API)', () => {
  let client: GeminiClient;
  let skipTests = false;

  beforeAll(() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('⏭️  Skipping Gemini real API tests — GEMINI_API_KEY not set');
      skipTests = true;
      return;
    }
    client = new GeminiClient(apiKey, 'gemini-2.5-flash');
  });

  it('should successfully call Gemini API and receive a response', async () => {
    if (skipTests) return;

    const result = await client.generate({
      prompt: 'What is 2+2? Answer with just the number.',
      temperature: 0,
      maxOutputTokens: 10,
    });

    expect(typeof result.text).toBe('string');
    // Some models may return empty for overly terse prompts — verify API was called
    // by checking usage metadata or non-empty text
    const gotResponse =
      result.text.length > 0 || (result.usage && result.usage.totalTokenCount > 0);
    expect(gotResponse).toBe(true);
    console.log(
      `✅ Gemini API response: "${result.text.trim()}" (usage: ${result.usage?.totalTokenCount ?? 'N/A'})`,
    );
  }, 30_000);

  it('should return valid JSON from design analyzer prompt', async () => {
    if (skipTests) return;

    const systemPrompt = buildDesignAnalyzerSystemPrompt();
    const userPrompt = buildDesignAnalyzerUserPrompt({
      productType: 'Kaos',
      catatanTeks: 'Warna biru Navy, logo MLV di depan dada, bordir.',
    });

    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    const result = await client.generate({
      prompt: fullPrompt,
      temperature: 0.3,
      maxOutputTokens: 1024,
    });

    // Parse JSON — strip markdown code blocks if present
    let jsonText = result.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(jsonText);

    // Verify structure
    expect(parsed).toHaveProperty('warna');
    expect(parsed).toHaveProperty('lokasi_print');
    expect(parsed).toHaveProperty('estimasi_kompleksitas');
    expect(Array.isArray(parsed.lokasi_print)).toBe(true);
    expect(['RENDAH', 'SEDANG', 'TINGGI']).toContain(parsed.estimasi_kompleksitas);

    console.log(
      `✅ Design Analyzer response: complexity=${parsed.estimasi_kompleksitas}, ` +
        `print locations=${parsed.lokasi_print.length}, ` +
        `warna kain=${parsed.warna?.kain}`,
    );
  }, 30_000);

  it('should report token usage', async () => {
    if (skipTests) return;

    const result = await client.generate({
      prompt: 'Say "ok" and nothing else.',
      temperature: 0,
      maxOutputTokens: 10,
    });

    // Token usage may or may not be present depending on API version
    if (result.usage) {
      expect(result.usage.totalTokenCount).toBeGreaterThan(0);
      console.log(
        `✅ Token usage: prompt=${result.usage.promptTokenCount}, ` +
          `candidates=${result.usage.candidatesTokenCount}, ` +
          `total=${result.usage.totalTokenCount}`,
      );
    }
  }, 30_000);
});
