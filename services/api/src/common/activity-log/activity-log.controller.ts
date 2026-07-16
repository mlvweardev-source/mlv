import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@mlv/auth';
import { Roles } from '../../domains/identity-access/guards/auth.guard';
import { ActivityLogService } from './activity-log.service';
import { FindActivityLogQueryDto } from './activity-log.dto';

/**
 * GET /activity-log — log system-wide (Fase 9 Bagian 4).
 *
 * RBAC: Owner & Manajer Produksi saja. §5.1 tidak eksplisit exclude
 * Penjahit, tapi log ini turunan dari banyak domain (Finance, Approval,
 * Shipping) yang Penjahit ❌ — ikuti akses domain paling ketat yang
 * relevan untuk overview system-wide.
 *
 * Riwayat per-order untuk Penjahit tetap tersedia via
 * GET /orders/:id/activity (akses order sudah difilter §5.1).
 */
@Controller('activity-log')
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  async findAll(@Query() query: FindActivityLogQueryDto) {
    return this.activityLogService.findAll(query);
  }
}
