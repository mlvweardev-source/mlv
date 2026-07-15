import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ShippingService } from '../services/shipping.service';
import { CreateShipmentDto, UpdateShipmentDto } from '../dto/shipping.dto';
import { AuthGuard, Roles, Public } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';

/**
 * Shipping Controller — kontrak §8
 *
 * RBAC (§5.1): Owner & Manajer Produksi full akses staff endpoints.
 * Tim Penjahit: TIDAK ada akses. Pelanggan: hanya endpoint tracking publik.
 *
 * Tracking publik (§8 + keputusan Fase 7 #4):
 * `GET /shipments/:token/track` — param adalah TOKEN UNIK acak
 * (bukan orderId polos yang bisa ditebak/di-enumerate). Token
 * di-generate saat shipment dibuat dan dibagikan ke pelanggan.
 */
@Controller('shipments')
@UseGuards(AuthGuard)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  // ==========================================
  // Staff endpoints (Owner & Manajer Produksi)
  // ==========================================

  /**
   * POST /shipments — Buat shipment baru.
   * Gate: order.status harus LUNAS (divalidasi di service via OrderService).
   */
  @Post()
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @HttpCode(HttpStatus.CREATED)
  async createShipment(@Body() dto: CreateShipmentDto) {
    return this.shippingService.createShipment(dto);
  }

  /**
   * GET /shipments — Daftar shipment.
   */
  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async findShipments() {
    return this.shippingService.findShipments();
  }

  // ==========================================
  // Public tracking (§8) — HARUS di atas route :id
  // agar `/:token/track` tidak tertelan `GET /shipments/:id`
  // ==========================================

  /**
   * GET /shipments/:token/track — Tracking publik via token unik.
   * Tanpa auth. Response minimal: status, kurir, resi, tanggal.
   * TIDAK ada harga/alamat/data pelanggan. Token salah → 404.
   */
  @Get(':token/track')
  @Public()
  async publicTracking(@Param('token', ParseUUIDPipe) token: string) {
    return this.shippingService.publicTracking(token);
  }

  /**
   * GET /shipments/:id — Detail shipment (staff).
   */
  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async getShipmentById(@Param('id', ParseUUIDPipe) id: string) {
    return this.shippingService.getShipmentById(id);
  }

  /**
   * PATCH /shipments/:id — Update shipment (resi/kurir/status/biaya/alamat).
   */
  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async updateShipment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShipmentDto) {
    return this.shippingService.updateShipment(id, dto);
  }
}
