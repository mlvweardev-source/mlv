import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '@mlv/auth';
import { InventoryService } from '../services/inventory.service';
import {
  CreateMaterialDto,
  CreateBomDto,
  ReserveStockDto,
  ReleaseStockDto,
  CreateStockMovementDto,
  CreatePurchaseOrderDto,
  CreateStockAdjustmentDto,
} from '../dto/inventory.dto';
import { AuthGuard, Roles, GetUser } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';

@Controller()
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ==========================================
  // Material Endpoints
  // ==========================================

  @Get('materials')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  async findMaterials() {
    return this.inventoryService.findMaterials();
  }

  @Post('materials')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async createMaterial(@Body() dto: CreateMaterialDto) {
    return this.inventoryService.createMaterial(dto);
  }

  // ==========================================
  // BOM Endpoints
  // ==========================================

  @Get('bom')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  async findAllBoms() {
    return this.inventoryService.findAllBoms();
  }

  @Get('bom/:productType')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  async getBom(@Param('productType') productType: string) {
    return this.inventoryService.getBom(productType);
  }

  @Post('bom')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async createBom(@Body() dto: CreateBomDto) {
    return this.inventoryService.createBom(dto);
  }

  // ==========================================
  // Stock Reservation Endpoints (Staff only)
  // ==========================================

  @Post('stock/reserve')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async reserveStock(@Body() dto: ReserveStockDto) {
    return this.inventoryService.reserveStock(dto);
  }

  @Post('stock/release')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async releaseStock(@Body() dto: ReleaseStockDto) {
    return this.inventoryService.releaseStock(dto);
  }

  // ==========================================
  // Stock Movement & Balance Endpoints
  // ==========================================

  @Post('stock/movements')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async createStockMovement(@Body() dto: CreateStockMovementDto) {
    return this.inventoryService.createStockMovement(dto);
  }

  @Get('stock/balance')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  async getStockBalances() {
    return this.inventoryService.getStockBalances();
  }

  // ==========================================
  // Purchase & Adjustment Endpoints
  // ==========================================

  @Get('purchases')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  async findPurchaseOrders() {
    return this.inventoryService.findPurchaseOrders();
  }

  @Post('purchases')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) {
    return this.inventoryService.createPurchaseOrder(dto);
  }

  /**
   * PATCH /purchases/:id/complete — tandai PO diterima.
   * Efek stok NYATA: stock_movements tipe IN + stock_balances bertambah
   * dalam satu transaksi (bukan sekadar flip status).
   */
  @Patch('purchases/:id/complete')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async completePurchaseOrder(@Param('id') id: string, @GetUser() actor: JwtPayload) {
    return this.inventoryService.completePurchaseOrder(id, actor.sub);
  }

  @Get('stock/adjustments')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  async findStockAdjustments() {
    return this.inventoryService.findStockAdjustments();
  }

  @Post('stock/adjustments')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async createStockAdjustment(@Body() dto: CreateStockAdjustmentDto) {
    return this.inventoryService.createStockAdjustment(dto);
  }
}
