import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Gemini Client Wrapper (§18 — packages/ai)
 *
 * Hanya dipakai oleh services/ai-gateway (satu-satunya pemegang API key).
 * Domain lain memanggil ai-gateway via HTTP, bukan import langsung.
 */

export interface GeminiGenerateOptions {
  prompt: string;
  /** Base64-encoded image data (optional, for image analysis) */
  imageData?: string;
  /** MIME type of the image (e.g., 'image/jpeg') */
  imageMimeType?: string;
  /** Max output tokens (default: 2048) */
  maxOutputTokens?: number;
  /** Temperature (default: 0.4 — lebih deterministic untuk ekstraksi) */
  temperature?: number;
}

export interface GeminiGenerateResult {
  text: string;
  /** Token usage from the API call */
  usage?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiClient {
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(apiKey: string, modelName = 'gemini-2.0-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  /**
   * Generate text response from Gemini.
   * Supports optional image input for multimodal analysis.
   */
  async generate(options: GeminiGenerateOptions): Promise<GeminiGenerateResult> {
    const { prompt, imageData, imageMimeType, maxOutputTokens = 2048, temperature = 0.4 } = options;

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        maxOutputTokens,
        temperature,
      },
    });

    // Build content parts
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];

    if (imageData && imageMimeType) {
      parts.unshift({
        inlineData: {
          mimeType: imageMimeType,
          data: imageData,
        },
      });
    }

    const result = await model.generateContent(parts);
    const response = result.response;
    const text = response.text();

    return {
      text,
      usage: result.response.usageMetadata
        ? {
            promptTokenCount: result.response.usageMetadata.promptTokenCount ?? 0,
            candidatesTokenCount: result.response.usageMetadata.candidatesTokenCount ?? 0,
            totalTokenCount: result.response.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
    };
  }
}
