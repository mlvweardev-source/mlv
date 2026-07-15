import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, EVENT_NAMES } from '@mlv/types';
import { FinanceService } from './services/finance.service';

/**
 * Finance Events Processor — Consumer BullMQ queue `finance-events` (§4, §7)
 *
 * Menggantikan FinanceEventListener (EventEmitter2) dari Fase 5.
 * Event dikonsumsi:
 * - ProductionCompleted → auto-generate invoice Pelunasan
 * - OrderCreated        → diterima (§4), belum ada efek khusus di fase ini
 *
 * Idempotency (§16): onProductionCompleted cek invoice PELUNASAN yang
 * sudah ada di DB sebelum membuat baru.
 */
@Injectable()
@Processor(QUEUES.FINANCE_EVENTS)
export class FinanceEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(FinanceEventsProcessor.name);

  constructor(private readonly financeService: FinanceService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing ${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`);

    switch (job.name) {
      case EVENT_NAMES.ProductionCompleted:
        await this.financeService.onProductionCompleted(job.data.orderId);
        break;

      case EVENT_NAMES.OrderCreated:
        // §4: Finance mengonsumsi OrderCreated — di fase ini cukup
        // diterima & di-log; efek spesifik menyusul saat dibutuhkan.
        this.logger.log(`OrderCreated diterima untuk order ${job.data.orderNumber}`);
        break;

      default:
        this.logger.warn(`Unknown event "${job.name}" di queue ${QUEUES.FINANCE_EVENTS} — skipped`);
    }
  }
}
