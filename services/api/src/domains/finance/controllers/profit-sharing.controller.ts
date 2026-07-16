import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { CreateProfitSharingDto, UpdateProfitSharingDto } from '../dto/finance.dto';
import { Roles, GetUser } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

/**
 * Profit Sharing endpoints — §8.
 *
 * §5.1 TEGAS: Owner-only — Manajer & Penjahit "❌" (bukan view-only).
 * RBAC dua lapis: @Roles(OWNER) di guard + cek actor.role di service.
 * Actor dari @GetUser() (JWT terverifikasi) — BUKAN header `x-user`.
 */
@Controller('profit-sharing')
@Roles(UserRole.OWNER)
export class ProfitSharingController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * GET /profit-sharing — Semua profit sharing (Owner only)
   */
  @Get()
  async getProfitSharing(@GetUser() actor: JwtPayload) {
    return this.financeService.getProfitSharing(actor);
  }

  /**
   * POST /profit-sharing — Tambah profit sharing (Owner only)
   */
  @Post()
  async createProfitSharing(@Body() dto: CreateProfitSharingDto, @GetUser() actor: JwtPayload) {
    return this.financeService.createProfitSharing(dto, actor);
  }

  /**
   * PATCH /profit-sharing/:id — Update profit sharing (Owner only)
   */
  @Patch(':id')
  async updateProfitSharing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfitSharingDto,
    @GetUser() actor: JwtPayload,
  ) {
    return this.financeService.updateProfitSharing(id, dto, actor);
  }

  /**
   * DELETE /profit-sharing/:id — Hapus profit sharing (Owner only)
   */
  @Delete(':id')
  async deleteProfitSharing(@Param('id', ParseUUIDPipe) id: string, @GetUser() actor: JwtPayload) {
    return this.financeService.deleteProfitSharing(id, actor);
  }
}
