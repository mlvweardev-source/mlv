import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiClient,
  buildDesignAnalyzerSystemPrompt,
  buildDesignAnalyzerUserPrompt,
} from '@mlv/ai';
import type { DesignAnalyzerInput } from '@mlv/ai';

export interface DesignAnalyzerResult {
  warna: {
    kain: string | null;
    aksen: string | null;
  };
  lokasi_print: Array<{
    lokasi: string;
    deskripsi: string;
    teknik: string;
  }>;
  estimasi_kompleksitas: 'RENDAH' | 'SEDANG' | 'TINGGI';
  catatan_tambahan: string | null;
  saran_untuk_pelanggan: string | null;
}

@Injectable()
export class DesignAnalyzerService {
  private readonly logger = new Logger(DesignAnalyzerService.name);
  private readonly geminiClient: GeminiClient | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.geminiClient = new GeminiClient(apiKey);
      this.logger.log('Gemini client initialized');
    } else {
      this.geminiClient = null;
      this.logger.warn(
        'GEMINI_API_KEY not set — Design Analyzer will return null (AI features disabled)',
      );
    }
  }

  /**
   * Analyze design notes and extract structured specifications.
   * Returns null if Gemini is not configured or if the call fails.
   */
  async analyze(input: DesignAnalyzerInput): Promise<DesignAnalyzerResult | null> {
    if (!this.geminiClient) {
      this.logger.warn('Gemini client not available — skipping analysis');
      return null;
    }

    try {
      const systemPrompt = buildDesignAnalyzerSystemPrompt();
      const userPrompt = buildDesignAnalyzerUserPrompt(input);

      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      this.logger.log(`Analyzing design for product: ${input.productType}`);

      const result = await this.geminiClient.generate({
        prompt: fullPrompt,
        temperature: 0.3,
        maxOutputTokens: 1024,
      });

      // Parse JSON from response — strip markdown code blocks if present
      let jsonText = result.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const parsed = JSON.parse(jsonText) as DesignAnalyzerResult;

      this.logger.log(
        `Analysis complete: complexity=${parsed.estimasi_kompleksitas}, ` +
          `print locations=${parsed.lokasi_print?.length ?? 0}`,
      );

      return parsed;
    } catch (error: any) {
      // AI selalu asistif, tidak pernah blocking (§17.4, §17.5)
      // Kalau gagal, return null — alur inti tetap jalan
      this.logger.error(`Design analysis failed: ${error.message}`);
      return null;
    }
  }
}
