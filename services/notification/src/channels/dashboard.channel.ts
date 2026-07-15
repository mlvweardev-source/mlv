import { Injectable } from '@nestjs/common';
import type {
  NotificationChannel,
  NotificationRecipient,
  SendResult,
} from './notification-channel.interface';

/**
 * DashboardChannel — notifikasi in-app (§12, keputusan Fase 8 #2).
 *
 * Tidak ada panggilan eksternal: "terkirim" untuk channel Dashboard
 * artinya baris notification_logs berstatus SENT — GET /notifications
 * membaca tabel yang sama, jadi notifikasi otomatis muncul di
 * notification center tanpa langkah tambahan.
 *
 * Penulisan log dilakukan dispatcher (satu tempat untuk semua channel);
 * channel ini tinggal menyatakan sukses.
 */
@Injectable()
export class DashboardChannel implements NotificationChannel {
  readonly channelName = 'DASHBOARD' as const;

  async send(_recipient: NotificationRecipient, _message: string): Promise<SendResult> {
    return { success: true, providerRef: 'dashboard' };
  }
}
