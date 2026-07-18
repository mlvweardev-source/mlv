import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const RESERVATION_EXPIRY_QUEUE = 'reservation-expiry';

/**
 * Reservation Expiry Scheduler (Fase 11)
 *
 * Mendaftarkan BullMQ repeatable job saat module diinisialisasi.
 * Job berjalan setiap 15 menit — cukup untuk auto-release reservasi
 * kadaluarsa tanpa perlu real-time presisi.
 */
@Injectable()
export class ReservationExpiryScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReservationExpiryScheduler.name);

  constructor(@InjectQueue(RESERVATION_EXPIRY_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Upsert repeatable job — idempotent: jika sudah ada, tidak membuat duplikat
    await this.queue.upsertJobScheduler(
      'check-expired-reservations',
      {
        every: 15 * 60 * 1000, // 15 menit
      },
      {
        data: {},
      },
    );

    this.logger.log(`Reservation expiry scheduler registered — runs every 15 minutes`);
  }
}
