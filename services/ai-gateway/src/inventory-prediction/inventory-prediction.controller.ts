import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { InventoryPredictionService } from './inventory-prediction.service';

interface PredictInventoryDto {
  stockBalances: Array<{
    materialNama: string;
    materialId: string;
    satuan: string;
    qtyAvailable: number;
    qtyReserved: number;
    freeStock: number;
  }>;
  usageTrends: Array<{
    materialNama: string;
    materialId: string;
    totalUsed: number;
    periodeHari: number;
    avgPerDay: number;
  }>;
  activeOrderCount: number;
  bomSummary: Array<{
    productType: string;
    materials: Array<{ materialNama: string; qtyPerUnit: number; satuan: string }>;
  }>;
  customerId: string;
}

@Controller('ai')
export class InventoryPredictionController {
  constructor(private readonly inventoryPredictionService: InventoryPredictionService) {}

  /**
   * POST /ai/inventory-prediction
   *
   * Menerima data stok saat ini + tren pemakaian material dari histori order,
   * Gemini kasih prediksi kebutuhan restock:
   * - Material mana yang bakal menipis
   * - Estimasi kapan
   * - Saran qty beli
   *
   * §9: Rekomendasi ke Manajer Produksi — tidak pernah auto-create Purchase Order.
   *
   * Rate limited: 50 request/jam per pelanggan (middleware di level module).
   */
  @Post('inventory-prediction')
  @HttpCode(HttpStatus.OK)
  async predict(@Body() dto: PredictInventoryDto) {
    const result = await this.inventoryPredictionService.predict({
      stockBalances: dto.stockBalances,
      usageTrends: dto.usageTrends,
      activeOrderCount: dto.activeOrderCount,
      bomSummary: dto.bomSummary,
    });

    return {
      prediksi: result,
    };
  }
}
