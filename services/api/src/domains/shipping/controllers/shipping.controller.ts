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
} from '@nestjs/common';
import { ShippingService } from '../services/shipping.service';
import { CreateShipmentDto, UpdateShipmentDto } from '../dto/shipping.dto';
import { AuthGuard, Roles, Public } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

/**
 * Shipping Controller — §8 API Contract
 *
 * RBAC (§5.1):
 * - Owner & Manajer Produksi: full akses POST / PATCH /shipments
 * - Staff lain & Customer: tidak punya akses
 *
 * Public endpoint (§8):
 * - GET /shipments/track/:token — tracking publik via token unik
 */
@Controller()
@UseGuards(AuthGuard)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  /**
   * POST /shipments — Buat shipment baru.
   * Gate: order.status harus LUNAS.
   */
  @Post('shipments')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @HttpCode(HttpStatus.CREATED)
  async createShipment(
    @Body() dto: CreateShipmentDto,
    @Param() _params: unknown,
    req: { user: JwtPayload },
  ) {
    return this.shippingService.createShipment(dto);
  }

  /**
   * PATCH /shipments/:id — Update shipment.
   */
  @Patch('shipments/:id')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async updateShipment(
    @Param('id') id: string,
    @Body() dto: UpdateShipmentDto,
    @Param() _params: unknown,
    req: { user: JwtPayload },
  ) {
    return this.shippingService.updateShipment(id, dto);
  }

  /**
   * GET /shipments — Daftar shipment (staff only).
   */
  @Get('shipments')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async findShipments(@Param() _params: unknown, req: { user: JwtPayload }) {
    return this.shippingService.findShipments();
  }

  /**
   * GET /shipments/:id — Detail shipment.
   */
  @Get('shipments/:id')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async getShipmentById(@Param('id') id: string, @Param() _params: unknown, req: { user: JwtPayload }) {
    return this.shippingService.getShipmentById(id);
  }

  // ==========================================
  // Public Tracking Endpoints (§8)
  // ==========================================

  /**
   * GET /shipments/track/:token — Tracking publik via token unik.
   * Tidak memerlukan auth. Hanya return info minimal.
   */
  @Get('shipments/track/:token')
  @Public()
  async publicTrackingByToken(@Param('token') token: string) {
    return this.shippingService.publicTracking(token);
  }

  /**
   * GET /shipments/:orderId/track — Tracking publik via order ID.
   * Endpoint ini sesuai kontrak §8 PRD.
   * Tidak memerlukan auth.
   */
  @Get('shipments/:orderId/track')
  @Public()
  async publicTrackingByOrderId(@Param('orderId') orderId: string) {
    return this.shippingService.publicTrackingByOrderId(orderId);
  }
}
