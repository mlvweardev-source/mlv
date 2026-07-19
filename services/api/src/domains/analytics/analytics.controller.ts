import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../identity-access/guards/auth.guard';
import { GetUser } from '../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { AnalyticsService } from './analytics.service';
import { DashboardQueryDto } from './dto/analytics.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /analytics/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * RBAC (§5.1):
   * - Owner: akses penuh semua 12 metrik (termasuk financial)
   * - Manajer Produksi: hanya metrik operasional (order, lead time, reject rate, stock accuracy)
   *   — TIDAK boleh melihat Omzet, Profit, AOV, Top Customer, Top Produk, Conversion, Repeat, Response Time
   *
   * Filtering dilakukan di service layer (AnalyticsService.getDashboard).
   */
  @Get('dashboard')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async getDashboard(@GetUser() actor: JwtPayload, @Query() query: DashboardQueryDto) {
    return this.analyticsService.getDashboard(actor, query.from, query.to);
  }
}
