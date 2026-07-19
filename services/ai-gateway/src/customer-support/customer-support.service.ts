import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiClient,
  buildCustomerSupportSystemPrompt,
  buildCustomerSupportUserPrompt,
} from '@mlv/ai';
import type { CustomerSupportInput } from '@mlv/ai';

export interface CustomerSupportResult {
  /** Apakah AI bisa menjawab pertanyaan dari konteks order */
  canAnswer: boolean;
  /** Jawaban untuk pelanggan (kosong jika canAnswer=false) */
  jawaban: string;
  /** Alasan eskalasi ke manusia (kosong jika canAnswer=true) */
  alasan_eskalasi: string;
}

/**
 * Customer Support Service (Fase 12 Bagian 2, §9)
 *
 * AI menjawab pertanyaan pelanggan dari data order aktual.
 * Prinsip utama: AI HANYA menjawab dari konteks yang diberikan.
 * Jika di luar konteks (diskon, komplain, perubahan) → escalate, JANGAN menebak.
 *
 * Fallback-safe: kalau Gemini gagal/timeout, return null (caller treat
 * sebagai "AI tidak tersedia" → fallback ke perilaku tanpa auto-reply).
 */
@Injectable()
export class CustomerSupportService {
  private readonly logger = new Logger(CustomerSupportService.name);
  private readonly geminiClient: GeminiClient | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.geminiClient = new GeminiClient(apiKey);
      this.logger.log('Gemini client initialized for Customer Support');
    } else {
      this.geminiClient = null;
      this.logger.warn(
        'GEMINI_API_KEY not set — Customer Support will return null (AI features disabled)',
      );
    }
  }

  /**
   * Try to answer a customer question from order context.
   * Returns null if Gemini is not configured or call fails.
   * Returns { canAnswer: false, ... } if question is out of scope.
   */
  async answer(input: CustomerSupportInput): Promise<CustomerSupportResult | null> {
    if (!this.geminiClient) {
      this.logger.warn('Gemini client not available — skipping customer support answer');
      return null;
    }

    try {
      const systemPrompt = buildCustomerSupportSystemPrompt();
      const userPrompt = buildCustomerSupportUserPrompt(input);
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      this.logger.log(
        `Customer support for order ${input.orderContext.orderNumber}: "${input.pertanyaan.slice(0, 50)}..."`,
      );

      const result = await this.geminiClient.generate({
        prompt: fullPrompt,
        // Lebih tinggi dari Design Analyzer — butuh lebih banyak natural language
        temperature: 0.5,
        maxOutputTokens: 512,
        jsonMode: true,
      });

      // Parse JSON — strip markdown code blocks if present, fallback ke
      // extract JSON object kalau AI menambahkan teks di luar JSON
      let jsonText = result.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      let parsed: CustomerSupportResult;
      try {
        parsed = JSON.parse(jsonText) as CustomerSupportResult;
      } catch (firstError) {
        const objectMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
          throw firstError;
        }
        parsed = JSON.parse(objectMatch[0]) as CustomerSupportResult;
      }

      // Validasi: canAnswer harus boolean
      if (typeof parsed.canAnswer !== 'boolean') {
        throw new Error('Response JSON tidak memiliki canAnswer boolean');
      }

      // canAnswer=true harus punya jawaban, canAnswer=false harus punya alasan
      if (parsed.canAnswer && !parsed.jawaban) {
        throw new Error('canAnswer=true tapi jawaban kosong');
      }
      if (!parsed.canAnswer && !parsed.alasan_eskalasi) {
        throw new Error('canAnswer=false tapi alasan_eskalasi kosong');
      }

      this.logger.log(
        `Customer support result: canAnswer=${parsed.canAnswer}` +
          (parsed.canAnswer ? ` (jawaban: ${parsed.jawaban.slice(0, 30)}...)` : ''),
      );

      return parsed;
    } catch (error: any) {
      // AI selalu asistif, tidak pernah blocking (§17.4, §17.5)
      this.logger.error(`Customer support answer failed: ${error.message}`);
      return null;
    }
  }
}
