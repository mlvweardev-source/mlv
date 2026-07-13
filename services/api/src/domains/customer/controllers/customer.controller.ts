import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { CustomerService } from '../services/customer.service';
import { UpdateCustomerDto, CreateReviewDto } from '../dto/customer.dto';
import { AuthGuard, Roles, AllowCustomer } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

@Controller('customers')
@UseGuards(AuthGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  /**
   * GET /customers/:id — Ambil profil pelanggan.
   * Akses: Pelanggan ybs, Owner, Manajer Produksi.
   */
  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async findOne(@Param('id') id: string, @Req() req: { user: JwtPayload }) {
    return this.customerService.findOne(id, req.user);
  }

  /**
   * PATCH /customers/:id — Update profil pelanggan.
   * Akses: Pelanggan ybs, Owner.
   */
  @Patch(':id')
  @Roles(UserRole.OWNER)
  @AllowCustomer()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.customerService.update(id, dto, req.user);
  }

  /**
   * GET /customers/:id/orders — Stub: daftar order pelanggan.
   * Akses: Pelanggan ybs, Owner, Manajer Produksi.
   * Order Domain belum ada (Fase 3) → return empty array.
   */
  @Get(':id/orders')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async findOrders(@Param('id') id: string, @Req() req: { user: JwtPayload }) {
    return this.customerService.findOrders(id, req.user);
  }

  /**
   * POST /customers/:id/reviews — Buat review.
   * Akses: Hanya pelanggan ybs.
   */
  @Post(':id/reviews')
  @AllowCustomer()
  async createReview(
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.customerService.createReview(id, dto, req.user);
  }
}
