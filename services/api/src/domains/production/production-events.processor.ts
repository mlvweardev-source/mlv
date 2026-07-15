import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, EVENT_NAMES } from '@mlv/types';
import { ProductionService } from './services/production.service';

/**
 * Production Events Processor — Consumer BullMQ queue `production-events` (§4, §7)
 *
 * Menggantikan OrderConfirmedListener (EventEmitter2) dari Fase 4.
 * Event dikonsumsi:
 * - OrderConfirmed → generate production_tasks dari routing (§7.2)
 * - StockReserved  → diterima (§4), belum ada efek khusus di fase ini
 *
 * Idempotency (§16): handleOrderConfirmed skip order item yang sudah
 * punya production tasks — event ganda tidak menghasilkan task ganda.
 */
@Injectable()
@Processor(QUEUES.PRODUCTION_EVENTS)
export class ProductionEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductionEventsProcessor.name);

  constructor(private readonly productionService: ProductionService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing ${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`);

    switch (job.name) {
      case EVENT_NAMES.OrderConfirmed:
        await this.productionService.handleOrderConfirmed(
          job.data.orderId,
          job.data.orderNumber,
          job.data.customerId,
        );
        break;

      case EVENT_NAMES.StockReserved:
        // §4: Production mengonsumsi StockReserved — di fase ini cukup
        // diterima & di-log; efek spesifik menyusul saat dibutuhkan.
        this.logger.log(
          `StockReserved diterima untuk order ${job.data.orderId} (material ${job.data.materialId})`,
        );
        break;

      default:
        this.logger.warn(
          `Unknown event "${job.name}" di queue ${QUEUES.PRODUCTION_EVENTS} — skipped`,
        );
    }
  }
}
