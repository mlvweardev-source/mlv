import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, EVENT_NAMES } from '@mlv/types';

/**
 * Shipping Events Processor — Consumer BullMQ queue `order-events` (§4, §7)
 *
 * NOTE: Shipping Domain adalah PUBLISHER (§4 — "ShipmentCreated", "ShipmentDelivered").
 * Tidak ada event yang secara eksplisit dikonsumsi oleh Shipping Domain di §7.1 PRD.
 *
 * Placeholder ini disiapkan untuk future use jika ada kebutuhan
 * consume event dari domain lain (misalnya notifikasi internal).
 *
 * Idempotency (§16): Jika handler ditambahkan, cek state DB dulu sebelum apply efek.
 */
@Injectable()
@Processor(QUEUES.ORDER_EVENTS)
export class ShippingEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(ShippingEventsProcessor.name);

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing ${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`);

    switch (job.name) {
      // Placeholder: tidak ada event yang dikonsumsi oleh Shipping Domain saat ini

      default:
        this.logger.warn(
          `Unknown event "${job.name}" di queue ${QUEUES.ORDER_EVENTS} — skipped (Shipping Domain tidak consuming event ini)`,
        );
    }
  }
}
