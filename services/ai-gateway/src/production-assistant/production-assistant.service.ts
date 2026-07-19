import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiClient,
  buildProductionAssistantSystemPrompt,
  buildProductionAssistantUserPrompt,
} from '@mlv/ai';
import type { ProductionAssistantInput } from '@mlv/ai';

export interface ProductionAssistantResult {
  estimasi_lead_time: string;
  bottleneck: {
    terdeteksi: boolean;
    tahap: string | null;
    alasan: string | null;
    jumlah_task_menumpuk: number | null;
  };
  saran_urutan: Array<{
    prioritas: 'TINGGI' | 'SEDANG' | 'RENDAH';
    tahap: string;
    saran: string;
    alasan: string;
  }>;
  ringkasan: string;
}

@Injectable()
export class ProductionAssistantService {
  private readonly logger = new Logger(ProductionAssistantService.name);
  private readonly geminiClient: GeminiClient | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.geminiClient = new GeminiClient(apiKey);
      this.logger.log('Gemini client initialized for Production Assistant');
    } else {
      this.geminiClient = null;
      this.logger.warn(
        'GEMINI_API_KEY not set — Production Assistant will return null (AI features disabled)',
      );
    }
  }

  /**
   * Analyze production state and return insights.
   * Returns null if Gemini is not configured or if the call fails.
   */
  async analyze(input: ProductionAssistantInput): Promise<ProductionAssistantResult | null> {
    if (!this.geminiClient) {
      this.logger.warn('Gemini client not available — skipping production analysis');
      return null;
    }

    try {
      const systemPrompt = buildProductionAssistantSystemPrompt();
      const userPrompt = buildProductionAssistantUserPrompt(input);
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      this.logger.log(
        `Production analysis: order ${input.orderNumber}, ${input.tasks.length} tasks`,
      );

      const result = await this.geminiClient.generate({
        prompt: fullPrompt,
        temperature: 0.3,
        maxOutputTokens: 1024,
        jsonMode: true,
      });

      let jsonText = result.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      let parsed: ProductionAssistantResult;
      try {
        parsed = JSON.parse(jsonText) as ProductionAssistantResult;
      } catch (firstError) {
        const objectMatch = jsonText.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
          throw firstError;
        }
        parsed = JSON.parse(objectMatch[0]) as ProductionAssistantResult;
      }

      this.logger.log(
        `Production analysis complete: bottleneck=${parsed.bottleneck?.terdeteksi ?? false}, ` +
          `suggestions=${parsed.saran_urutan?.length ?? 0}`,
      );

      return parsed;
    } catch (error: any) {
      this.logger.error(`Production analysis failed: ${error.message}`);
      return null;
    }
  }
}
