import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { DesignAnalyzerService } from './design-analyzer.service';

interface AnalyzeDesignDto {
  catatanTeks?: string;
  productType: string;
  customerId: string;
}

@Controller('ai')
export class DesignAnalyzerController {
  constructor(private readonly designAnalyzerService: DesignAnalyzerService) {}

  /**
   * POST /ai/design-analyzer
   *
   * Menerima catatan teks desain (+ referensi file kalau relevan),
   * Gemini ekstrak spesifikasi terstruktur (warna, lokasi print,
   * estimasi kompleksitas) dalam format JSON.
   *
   * Rate limited: 50 request/jam per pelanggan (middleware di level module).
   */
  @Post('design-analyzer')
  @HttpCode(HttpStatus.OK)
  async analyze(@Body() dto: AnalyzeDesignDto) {
    const result = await this.designAnalyzerService.analyze({
      catatanTeks: dto.catatanTeks,
      productType: dto.productType,
    });

    return {
      hasil_ekstraksi_ai: result,
    };
  }
}
