import { Controller, Post, Body, Req, BadRequestException, UseGuards } from '@nestjs/common';
import { AllowCustomer, AuthGuard, Roles } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { AiAssistantService } from '../services/ai-assistant.service';
import { ProductionService } from '../../production/services/production.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { OrderService } from '../services/order.service';

/**
 * AI Assistant endpoints (Fase 12 Bagian 2 + 3)
 *
 * Proxy ke ai-gateway. services/api sbg orchestration layer.
 * - Quotation Assistant: Owner/Manajer minta saran harga.
 * - Customer Support: dipanggil oleh CustomerChatService.
 * - Production Assistant: Owner/Manajer minta insight produksi.
 * - Inventory Prediction: Owner/Manajer minta prediksi restock.
 *
 * §17.4: Hasil Quotation HANYA saran, harga final manusia.
 * §9: Customer Support HANYA jawab dari konteks, escalate kalau di luar.
 * §9: Production Assistant HANYA saran — tidak auto-reorder task.
 * §9: Inventory Prediction HANYA saran — tidak auto-create PO.
 *
 * Prinsip Fase 8: ai-gateway TIDAK query balik ke domain lain.
 * Semua data harus lengkap di payload dari services/api.
 */
@Controller('ai-assistant')
@UseGuards(AuthGuard)
export class AiAssistantController {
  constructor(
    private readonly aiAssistantService: AiAssistantService,
    private readonly productionService: ProductionService,
    private readonly inventoryService: InventoryService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * POST /ai-assistant/quotation
   *
   * Minta saran harga AI. Owner & Manajer saja (aksi internal staf).
   */
  @Post('quotation')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async suggestQuotation(
    @Body()
    dto: {
      productType: string;
      qty: number;
      complexity?: 'RENDAH' | 'SEDANG' | 'TINGGI' | null;
      designSummary?: string | null;
      catatanStaf?: string;
      basePriceReference?: number;
    },
    @Req() req: { user: JwtPayload },
  ) {
    if (!dto.productType || !dto.qty || dto.qty <= 0) {
      throw new BadRequestException('productType dan qty (>0) wajib diisi');
    }

    return this.aiAssistantService.suggestQuotation(dto, req.user.sub);
  }

  /**
   * POST /ai-assistant/customer-support
   *
   * Internal endpoint — dipanggil oleh CustomerChatService.
   * @AllowCustomer() karena konteks orderContext sudah lengkap dan
   * customerId dari token (sumber kebenaran).
   *
   * Response: { hasil: { canAnswer, jawaban, alasan_eskalasi } | null }
   * - canAnswer=true → Caller post balasan ke thread chat sbg senderType='ai_bot'
   * - canAnswer=false → Caller tidak post auto-reply, biarkan staf balas manual
   * - hasil=null → AI tidak tersedia, caller fallback ke no auto-reply
   */
  @Post('customer-support')
  @AllowCustomer()
  async customerSupport(
    @Body()
    dto: {
      pertanyaan: string;
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
      };
    },
    @Req() req: { user: JwtPayload },
  ) {
    if (!dto.pertanyaan || !dto.orderContext) {
      throw new BadRequestException('pertanyaan dan orderContext wajib diisi');
    }

    return this.aiAssistantService.answerCustomerQuestion(
      dto.pertanyaan,
      dto.orderContext,
      req.user.sub,
    );
  }

  /**
   * POST /ai-assistant/production-assistant
   *
   * Minta insight produksi AI untuk satu order. Owner & Manajer saja.
   * §9: HANYA saran — tidak pernah auto-reorder task atau ubah assignment.
   */
  @Post('production-assistant')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async productionAssistant(@Body() dto: { orderId: string }, @Req() req: { user: JwtPayload }) {
    if (!dto.orderId) {
      throw new BadRequestException('orderId wajib diisi');
    }

    // Kumpulkan konteks dari Production Domain (DDD §4.1: service method)
    const context = await this.productionService.getProductionContextForAi(dto.orderId);
    if (!context) {
      throw new BadRequestException('Order tidak ditemukan');
    }

    // Kirim ke ai-gateway
    return this.aiAssistantService.suggestProductionAnalysis(context, req.user.sub);
  }

  /**
   * POST /ai-assistant/inventory-prediction
   *
   * Minta prediksi restock AI. Owner & Manajer saja.
   * §9: HANYA saran — tidak pernah auto-create Purchase Order.
   */
  @Post('inventory-prediction')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async inventoryPrediction(@Req() req: { user: JwtPayload }) {
    // Kumpulkan konteks dari Inventory Domain + Order Domain (DDD §4.1)
    const orderTrends = await this.orderService.getOrderVolumeTrends(30);
    const inventoryContext = await this.inventoryService.getInventoryContextForAi(orderTrends);

    return this.aiAssistantService.predictInventory(inventoryContext, req.user.sub);
  }
}
