import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { QuotationAssistantService } from './quotation-assistant.service';

/**
 * Interface for the request body. customerId is required for rate limiting
 * (paritas dengan DesignAnalyzer controller).
 */
interface SuggestQuotationDto {
  productType: string;
  qty: number;
  complexity?: 'RENDAH' | 'SEDANG' | 'TINGGI' | null;
  designSummary?: string | null;
  catatanStaf?: string;
  basePriceReference?: number;
  customerId: string;
}

@Controller('ai')
export class QuotationAssistantController {
  constructor(private readonly quotationAssistantService: QuotationAssistantService) {}

  /**
   * POST /ai/quotation-assistant
   *
   * Menerima detail order + (opsional) hasil Design Analyzer, mengembalikan
   * saran range harga per pcs + total estimasi.
   *
   * §17.4: Hasil WAJIB dikonfirmasi manusia sebelum final. AI tidak pernah
   * auto-apply — staf yang input harga akhir lewat approval "Harga Khusus".
   *
   * Rate limited: 50 request/jam per pelanggan (middleware di level module).
   */
  @Post('quotation-assistant')
  @HttpCode(HttpStatus.OK)
  async suggest(@Body() dto: SuggestQuotationDto) {
    const result = await this.quotationAssistantService.suggest({
      productType: dto.productType,
      qty: dto.qty,
      complexity: dto.complexity ?? null,
      designSummary: dto.designSummary ?? null,
      catatanStaf: dto.catatanStaf,
      basePriceReference: dto.basePriceReference,
    });

    return {
      saran_harga: result,
    };
  }
}
