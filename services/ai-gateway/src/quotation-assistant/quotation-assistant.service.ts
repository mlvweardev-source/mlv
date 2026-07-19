import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiClient, buildQuotationSystemPrompt, buildQuotationUserPrompt } from '@mlv/ai';
import type { QuotationAssistantInput } from '@mlv/ai';

export interface QuotationAssistantResult {
  harga_per_pcs: {
    low: number;
    high: number;
  };
  total_estimasi: {
    low: number;
    high: number;
  };
  alasan: string;
  faktor_pendorong_harga: string[];
  saran_untuk_staf: string | null;
}

/**
 * Quotation Assistant Service (Fase 12 Bagian 2, §17.4)
 *
 * Memberi saran range harga untuk order. AI HANYA menyarankan —
 * harga final selalu di-input manusia lewat Approval "Harga Khusus"
 * (Fase 5, §13). AI tidak pernah auto-apply.
 *
 * Fallback-safe: kalau Gemini gagal/timeout, return null — caller
 * bisa tangani sebagai "AI tidak tersedia" tanpa memblokir alur.
 */
@Injectable()
export class QuotationAssistantService {
  private readonly logger = new Logger(QuotationAssistantService.name);
  private readonly geminiClient: GeminiClient | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.geminiClient = new GeminiClient(apiKey);
      this.logger.log('Gemini client initialized for Quotation Assistant');
    } else {
      this.geminiClient = null;
      this.logger.warn(
        'GEMINI_API_KEY not set — Quotation Assistant will return null (AI features disabled)',
      );
    }
  }

  /**
   * Get price range suggestion for an order.
   * Returns null if Gemini is not configured or if the call fails.
   */
  async suggest(input: QuotationAssistantInput): Promise<QuotationAssistantResult | null> {
    if (!this.geminiClient) {
      this.logger.warn('Gemini client not available — skipping quotation suggestion');
      return null;
    }

    try {
      const systemPrompt = buildQuotationSystemPrompt();
      const userPrompt = buildQuotationUserPrompt(input);
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      this.logger.log(
        `Quotation suggestion: ${input.productType} x${input.qty}` +
          (input.complexity ? ` [${input.complexity}]` : ''),
      );

      const result = await this.geminiClient.generate({
        prompt: fullPrompt,
        temperature: 0.3,
        maxOutputTokens: 1024,
        jsonMode: true,
      });

      // Parse JSON — strip markdown code blocks if present, fallback ke
      // extract JSON object kalau AI menambahkan teks di luar JSON
      let jsonText = result.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      // Kalau parse langsung gagal, coba extract JSON object dari response
      let parsed: QuotationAssistantResult;
      try {
        parsed = JSON.parse(jsonText) as QuotationAssistantResult;
      } catch (firstError) {
        const objectMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
          throw firstError;
        }
        parsed = JSON.parse(objectMatch[0]) as QuotationAssistantResult;
      }

      // Validasi dasar
      if (!parsed.harga_per_pcs || !parsed.total_estimasi) {
        throw new Error('Response JSON tidak memiliki struktur harga_per_pcs/total_estimasi');
      }
      if (parsed.harga_per_pcs.low > parsed.harga_per_pcs.high) {
        this.logger.warn(
          `AI returned low > high (${parsed.harga_per_pcs.low} > ${parsed.harga_per_pcs.high}) — swapping`,
        );
        [parsed.harga_per_pcs.low, parsed.harga_per_pcs.high] = [
          parsed.harga_per_pcs.high,
          parsed.harga_per_pcs.low,
        ];
      }

      this.logger.log(
        `Quotation result: Rp ${parsed.harga_per_pcs.low.toLocaleString('id-ID')}` +
          ` - Rp ${parsed.harga_per_pcs.high.toLocaleString('id-ID')} per pcs`,
      );

      return parsed;
    } catch (error: any) {
      // AI selalu asistif, tidak pernah blocking (§17.4, §17.5)
      this.logger.error(`Quotation suggestion failed: ${error.message}`);
      return null;
    }
  }
}
