// ==========================================
// Identity & Access Domain Events (Fase 10)
// ==========================================
import type { OtpRequestedPayload } from '@mlv/types';

/**
 * auth.otp.requested — diterbitkan saat pelanggan meminta kode OTP login.
 *
 * Dikonsumsi HANYA oleh Notification Domain (proses terpisah) yang
 * mengirim kode via FonnteChannel (WA). services/api TIDAK memanggil
 * Fonnte langsung — boundary Fase 8: semua pengiriman pesan lewat
 * queue `notification-events`.
 *
 * Payload berisi kode OTP plaintext (kebutuhan render pesan WA) —
 * Notification menandai event ini SENSITIF dan me-mask kode di
 * notification_logs.
 */
export class OtpRequestedEvent implements OtpRequestedPayload {
  static readonly eventName = 'auth.otp.requested';

  constructor(
    public readonly customerNoHp: string,
    public readonly kode: string,
    public readonly berlakuMenit: number,
    public readonly requestedAt: string,
  ) {}
}
