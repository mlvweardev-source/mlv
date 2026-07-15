import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, EVENT_NAMES } from '@mlv/types';

/**
 * Notification Events Processor — Consumer queue `notification-events` (§4, §7)
 *
 * Berjalan di PROSES TERPISAH (services/notification, port 3001) dari
 * services/api — event melintasi proses lewat Redis (BullMQ), bukti
 * nyata event bus lintas proses (§18.1).
 *
 * Fase 6: cukup menerima & me-log event kunci (§4: Notification =
 * subscriber umum untuk hampir seluruh event domain lain).
 * Logic dispatch multi-channel (WA/Email/template) = Fase 8.
 */
@Injectable()
@Processor(QUEUES.NOTIFICATION_EVENTS)
export class NotificationEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationEventsProcessor.name);

  async process(job: Job): Promise<void> {
    // §4: subscriber umum — terima semua event, log penerimaannya.
    this.logger.log(
      `[CROSS-PROCESS] Event diterima dari services/api via Redis: ` +
        `${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`,
    );
    this.logger.log(`Payload: ${JSON.stringify(job.data)}`);

    // Highlight event kunci untuk pembuktian cascade §7.2
    if (job.name === EVENT_NAMES.PaymentSucceeded) {
      this.logger.log(
        `>>> PaymentSucceeded untuk order ${job.data.orderId} ` +
          `(${job.data.jenis}, Rp ${Number(job.data.jumlah).toLocaleString()}) — ` +
          `Fase 8 akan kirim WA "Pembayaran diterima, pesanan masuk antrean"`,
      );
    }
  }
}
