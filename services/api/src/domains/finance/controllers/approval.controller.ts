import { Controller, Get, Post, Patch, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { CreateApprovalDto, DecideApprovalDto } from '../dto/finance.dto';
import { Roles, GetUser } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

/**
 * Approval Workflow endpoints — §8, §13.
 *
 * RBAC (Fase 9.3): actor dari @GetUser() (payload JWT terverifikasi
 * AuthGuard) — BUKAN header `x-user` yang bisa dipalsukan client.
 * §5.1: Owner approve/reject; Manajer ajukan saja + lihat request
 * miliknya sendiri (difilter di service).
 */
@Controller('approvals')
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
export class ApprovalController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * GET /approvals — Owner lihat semua; Manajer hanya miliknya (§5.1)
   */
  @Get()
  async getApprovals(@GetUser() actor: JwtPayload, @Query('status') status?: string) {
    return this.financeService.getApprovals(status, actor);
  }

  /**
   * POST /approvals — Ajukan approval request (Manajer/Owner)
   */
  @Post()
  async createApproval(@Body() dto: CreateApprovalDto, @GetUser() actor: JwtPayload) {
    return this.financeService.createApproval(dto, actor);
  }

  /**
   * PATCH /approvals/:id/decide — Putuskan approval
   * Hanya Owner (ditegakkan di service)
   */
  @Patch(':id/decide')
  async decideApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideApprovalDto,
    @GetUser() actor: JwtPayload,
  ) {
    return this.financeService.decideApproval(id, dto, actor);
  }
}
