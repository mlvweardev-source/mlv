import { Global, Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogController } from './activity-log.controller';

/**
 * Activity Log Module (§6.8) — infrastruktur cross-cutting Fase 9.4.
 *
 * @Global (pola sama dengan EventBusModule): ActivityLogService bisa
 * di-inject di domain manapun tanpa import berulang — ini utilitas
 * bersama (in-process, synchronous), bukan bounded context.
 */
@Global()
@Module({
  controllers: [ActivityLogController],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
