import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Reusable AI gateway proxy service (Fase 12 Bagian 2)
 *
 * services/api → services/ai-gateway (HTTP).
 * Prinsip Fase 8: ai-gateway tidak query balik ke domain lain — semua
 * data order harus lengkap di payload dari sini.
 *
 * Fail-safe: timeout 15 detik, kalau gagal return null (jangan throw).
 * Caller bisa handle sebagai "AI tidak tersedia" tanpa memblokir alur.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly aiGatewayUrl: string;
  private readonly timeoutMs = 15_000;

  constructor(private readonly configService: ConfigService) {
    this.aiGatewayUrl = this.configService.get<string>('AI_GATEWAY_URL') || 'http://localhost:3002';
  }

  /**
   * Panggil AI Quotation Assistant. Return null kalau AI tidak tersedia
   * atau gagal/timeout.
   */
  async suggestQuotation(
    input: {
      productType: string;
      qty: number;
      complexity?: 'RENDAH' | 'SEDANG' | 'TINGGI' | null;
      designSummary?: string | null;
      catatanStaf?: string;
      basePriceReference?: number;
    },
    customerId: string,
  ): Promise<{ saran_harga: unknown } | null> {
    return this.callAi<{ saran_harga: unknown }>('/ai/quotation-assistant', {
      ...input,
      customerId,
    });
  }

  /**
   * Panggil AI Customer Support. Return null kalau AI tidak tersedia.
   * Caller (CustomerChatService) memutuskan: kalau hasil ada & canAnswer,
   * post auto-reply; kalau tidak, biarkan pesan masuk tanpa balasan AI.
   */
  async answerCustomerQuestion(
    pertanyaan: string,
    orderContext: {
      orderNumber: string;
      status: string;
      items: Array<{ productType: string; qty: number; basePriceSnapshot: number }>;
      timeline: Array<{ tipeEvent: string; deskripsi: string; createdAt: string }>;
      payments: Array<{
        jenis: 'DP' | 'PELUNASAN';
        jumlah: number;
        status: string;
        createdAt: string;
      }>;
      invoices: Array<{ jenis: 'DP' | 'PELUNASAN'; jumlah: number; status: string }>;
      shipment: {
        kurir: string;
        noResi: string | null;
        status: string;
        shippedAt: string | null;
        deliveredAt: string | null;
      } | null;
    },
    customerId: string,
  ): Promise<{ hasil: unknown } | null> {
    return this.callAi<{ hasil: unknown }>('/ai/customer-support', {
      pertanyaan,
      orderContext,
      customerId,
    });
  }

  private async callAi<T>(path: string, body: unknown): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.aiGatewayUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        // Rate limit (429), AI error (500), atau service unavailable (503)
        this.logger.warn(
          `AI gateway returned ${response.status} for ${path} (fail-safe: returning null)`,
        );
        return null;
      }

      return (await response.json()) as T;
    } catch (error: any) {
      clearTimeout(timeout);
      // AI selalu asistif, tidak pernah blocking (§17.4, §17.5)
      this.logger.warn(
        `AI gateway call failed for ${path}: ${error.message} (fail-safe: returning null)`,
      );
      return null;
    }
  }
}
