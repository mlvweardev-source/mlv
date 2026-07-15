import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '@mlv/types';
import { DispatcherService } from './dispatcher/dispatcher.service';

/**
 * Notification Events Processor — Consumer queue `notification-events` (§4, §7)
 *
 * Berjalan di PROSES TERPISAH (services/notification, port 3001) dari
 * services/api — event melintasi proses lewat Redis (BullMQ).
 *
 * Fase 8: setiap event diteruskan ke DispatcherService (alur §12:
 * template lookup → render → send via channel → log). Event tanpa
 * template aktif = no-op (subscriber umum menerima SEMUA event, tapi
 * hanya yang punya template yang menghasilkan notifikasi).
 *
 * Retry: throw saat ada kegagalan kirim → BullMQ retry 3x exponential
 * backoff (EVENT_JOB_OPTIONS); yang sudah SENT tidak terkirim ulang
 * karena dedup_key di DispatcherService (§16).
 */
@Injectable()
@Processor(QUEUES.NOTIFICATION_EVENTS)
export class NotificationEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationEventsProcessor.name);

  constructor(private readonly dispatcher: DispatcherService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(
      `[CROSS-PROCESS] Event diterima dari services/api via Redis: ` +
        `${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`,
    );

    const summary = await this.dispatcher.dispatchEvent(
      job.name,
      job.data as Record<string, unknown>,
    );

    // Gagal kirim → throw supaya BullMQ retry (log FAILED sudah tercatat;
    // attempt berikutnya hanya mengulang yang belum SENT berkat dedup).
    if (summary.failed > 0) {
      throw new Error(
        `${summary.failed} notifikasi gagal dikirim untuk event ${job.name} — retry via BullMQ`,
      );
    }
  }
}
