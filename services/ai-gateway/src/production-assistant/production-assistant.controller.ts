import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ProductionAssistantService } from './production-assistant.service';

interface AnalyzeProductionDto {
  orderNumber: string;
  orderStatus: string;
  tasks: Array<{
    taskType: string;
    sequence: number;
    status: string;
    assignedToNama: string | null;
    productType: string;
    startedAt: string | null;
  }>;
  taskCountByStage: Record<string, { total: number; active: number; waiting: number }>;
  customerId: string;
}

@Controller('ai')
export class ProductionAssistantController {
  constructor(private readonly productionAssistantService: ProductionAssistantService) {}

  /**
   * POST /ai/production-assistant
   *
   * Menerima state task produksi dari ProductionService, Gemini kasih:
   * - Estimasi lead time order
   * - Deteksi bottleneck (tahap mana yang task-nya menumpuk)
   * - Saran urutan task kalau bisa dioptimasi
   *
   * §9: Rekomendasi, bukan otomatisasi — tidak pernah auto-reorder task.
   *
   * Rate limited: 50 request/jam per pelanggan (middleware di level module).
   */
  @Post('production-assistant')
  @HttpCode(HttpStatus.OK)
  async analyze(@Body() dto: AnalyzeProductionDto) {
    const result = await this.productionAssistantService.analyze({
      orderNumber: dto.orderNumber,
      orderStatus: dto.orderStatus,
      tasks: dto.tasks,
      taskCountByStage: dto.taskCountByStage,
    });

    return {
      insight: result,
    };
  }
}
