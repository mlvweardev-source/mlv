import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, EVENT_NAMES } from '@mlv/types';
import { InventoryService } from './services/inventory.service';

/**
 * Inventory Events Processor — Consumer BullMQ queue `inventory-events` (§4, §7)
 *
 * Event dikonsumsi:
 * - OrderConfirmed  → kunci reservasi jadi deduction permanen (§7.2)
 * - PaymentFailed   → lepas reservasi
 * - PaymentExpired  → lepas reservasi
 *
 * Idempotency (§16): efek hanya diterapkan ke reservasi berstatus ACTIVE —
 * event ganda jadi no-op karena reservasi sudah CONSUMED/RELEASED.
 */
@Injectable()
@Processor(QUEUES.INVENTORY_EVENTS)
export class InventoryEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(InventoryEventsProcessor.name);

  constructor(private readonly inventoryService: InventoryService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing ${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`);

    switch (job.name) {
      case EVENT_NAMES.OrderConfirmed:
        // §7.2: kunci reservasi jadi pengurangan stok permanen (via stock_movements)
        await this.inventoryService.consumeReservationsForOrder(job.data.orderId);
        break;

      case EVENT_NAMES.PaymentFailed:
      case EVENT_NAMES.PaymentExpired:
        // §7.1: lepas reservasi
        await this.inventoryService.releaseReservationsForOrder(job.data.orderId);
        break;

      default:
        this.logger.warn(
          `Unknown event "${job.name}" di queue ${QUEUES.INVENTORY_EVENTS} — skipped`,
        );
    }
  }
}
