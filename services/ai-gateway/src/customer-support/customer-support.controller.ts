import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CustomerSupportService } from './customer-support.service';

interface AnswerCustomerQuestionDto {
  pertanyaan: string;
  orderContext: {
    orderNumber: string;
    status: string;
    items: Array<{
      productType: string;
      qty: number;
      basePriceSnapshot: number;
    }>;
    timeline: Array<{
      tipeEvent: string;
      deskripsi: string;
      createdAt: string;
    }>;
    payments: Array<{
      jenis: 'DP' | 'PELUNASAN';
      jumlah: number;
      status: string;
      createdAt: string;
    }>;
    invoices: Array<{
      jenis: 'DP' | 'PELUNASAN';
      jumlah: number;
      status: string;
    }>;
    shipment: {
      kurir: string;
      noResi: string | null;
      status: string;
      shippedAt: string | null;
      deliveredAt: string | null;
    } | null;
  };
  customerId: string;
}

@Controller('ai')
export class CustomerSupportController {
  constructor(private readonly customerSupportService: CustomerSupportService) {}

  /**
   * POST /ai/customer-support
   *
   * Menerima pertanyaan pelanggan + konteks order aktual (dikumpulkan
   * services/api, bukan ai-gateway — prinsip Fase 8 bahwa payload event
   * harus lengkap di sisi publisher).
   *
   * Return:
   * - canAnswer=true → jawaban untuk di-post ke thread chat (senderType='ai_bot')
   * - canAnswer=false → eskalasi ke manusia (tidak post auto-reply)
   * - saran_harga=null → AI tidak tersedia, caller fallback ke no auto-reply
   *
   * Rate limited: 50 request/jam per pelanggan (shared dengan layanan AI lain).
   */
  @Post('customer-support')
  @HttpCode(HttpStatus.OK)
  async answer(@Body() dto: AnswerCustomerQuestionDto) {
    const result = await this.customerSupportService.answer({
      pertanyaan: dto.pertanyaan,
      orderContext: dto.orderContext,
    });

    return {
      hasil: result,
    };
  }
}
