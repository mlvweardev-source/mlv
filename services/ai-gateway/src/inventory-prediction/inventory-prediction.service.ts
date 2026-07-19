import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiClient,
  buildInventoryPredictionSystemPrompt,
  buildInventoryPredictionUserPrompt,
} from '@mlv/ai';
import type { InventoryPredictionInput } from '@mlv/ai';

export interface InventoryPredictionItem {
  materialNama: string;
  materialId: string;
  status: 'KRITIS' | 'RENDAH' | 'AMAN';
  stok_saat_ini: number;
  free_stock: number;
  avg_per_day: number;
  estimasi_habis_hari: number;
  saran_qty_beli: number;
  satuan: string;
  alasan: string;
}

export interface InventoryPredictionResult {
  prediksi: InventoryPredictionItem[];
  ringkasan: string;
  rekomendasi_umum: string;
}

@Injectable()
export class InventoryPredictionService {
  private readonly logger = new Logger(InventoryPredictionService.name);
  private readonly geminiClient: GeminiClient | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.geminiClient = new GeminiClient(apiKey);
      this.logger.log('Gemini client initialized for Inventory Prediction');
    } else {
      this.geminiClient = null;
      this.logger.warn(
        'GEMINI_API_KEY not set — Inventory Prediction will return null (AI features disabled)',
      );
    }
  }

  /**
   * Analyze inventory state and predict restock needs.
   * Returns null if Gemini is not configured or if the call fails.
   */
  async predict(input: InventoryPredictionInput): Promise<InventoryPredictionResult | null> {
    if (!this.geminiClient) {
      this.logger.warn('Gemini client not available — skipping inventory prediction');
      return null;
    }

    try {
      const systemPrompt = buildInventoryPredictionSystemPrompt();
      const userPrompt = buildInventoryPredictionUserPrompt(input);
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      this.logger.log(
        `Inventory prediction: ${input.stockBalances.length} materials, ` +
          `${input.usageTrends.length} trends, ${input.activeOrderCount} active orders`,
      );

      const result = await this.geminiClient.generate({
        prompt: fullPrompt,
        temperature: 0.3,
        maxOutputTokens: 2048,
        jsonMode: true,
      });

      let jsonText = result.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      let parsed: InventoryPredictionResult;
      try {
        parsed = JSON.parse(jsonText) as InventoryPredictionResult;
      } catch (firstError) {
        const objectMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
          throw firstError;
        }
        parsed = JSON.parse(objectMatch[0]) as InventoryPredictionResult;
      }

      // Validasi dasar
      if (!Array.isArray(parsed.prediksi)) {
        throw new Error('Response JSON tidak memiliki array prediksi');
      }

      this.logger.log(
        `Inventory prediction complete: ${parsed.prediksi.length} materials analyzed, ` +
          `kritis=${parsed.prediksi.filter((p) => p.status === 'KRITIS').length}`,
      );

      return parsed;
    } catch (error: any) {
      this.logger.error(`Inventory prediction failed: ${error.message}`);
      return null;
    }
  }
}
