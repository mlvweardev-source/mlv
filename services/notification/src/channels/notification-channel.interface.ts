// ==========================================
// Kontrak Channel Notifikasi (§12, Fase 8 keputusan #1-2)
//
// SEMUA channel (WA/Email/Dashboard/Push) implement interface ini.
// Dispatcher hanya bergantung pada interface — mengganti Fonnte ke
// WhatsApp Cloud API resmi nanti = tambah 1 class implementasi baru,
// TIDAK menyentuh dispatcher apalagi domain penerbit event.
// ==========================================
import type { NotificationChannel as PrismaChannelEnum } from '@mlv/db';

/** Penerima notifikasi — identitas + alamat per channel. */
export interface NotificationRecipient {
  /** ID customer (channel customer-facing, mis. WA) — null untuk internal */
  customerId: string | null;
  /** ID user staff (channel internal, mis. Dashboard) — null untuk pelanggan */
  userId: string | null;
  /** Nomor HP (dibutuhkan channel WHATSAPP) */
  noHp?: string | null;
  /** Email (dibutuhkan channel EMAIL — belum dipakai Fase 8) */
  email?: string | null;
}

export interface SendResult {
  success: boolean;
  /** Pesan error jika gagal (disimpan ke notification_logs.error_msg) */
  errorMsg?: string;
  /** ID eksternal dari provider (mis. Fonnte message id) — untuk debugging */
  providerRef?: string;
}

/**
 * Interface channel generik — method `send(recipient, message)`.
 */
export interface NotificationChannel {
  /** Nilai enum Prisma NotificationChannel yang ditangani class ini */
  readonly channelName: PrismaChannelEnum;

  send(recipient: NotificationRecipient, message: string): Promise<SendResult>;
}

/** Injection token untuk daftar channel yang terdaftar di module. */
export const NOTIFICATION_CHANNELS = 'NOTIFICATION_CHANNELS';
