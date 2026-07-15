import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NotificationChannel,
  NotificationRecipient,
  SendResult,
} from './notification-channel.interface';

/**
 * FonnteChannel — kirim WhatsApp via Fonnte (provider tidak resmi).
 *
 * Keputusan Fase 8 #1: Fonnte dipilih karena volume rendah/biaya murah/
 * setup cepat. SEMUA logic Fonnte terkurung di class ini — migrasi ke
 * WhatsApp Cloud API resmi nanti cukup tulis class baru yang implement
 * NotificationChannel, daftar di module, selesai. Tidak ada kode Fonnte
 * di dispatcher/domain lain.
 *
 * Mode sandbox: jika FONNTE_API_TOKEN kosong, pesan TIDAK dikirim ke
 * API riil — di-log saja dan dianggap sukses (untuk dev/CI/demo tanpa
 * kredensial). Produksi wajib set FONNTE_API_TOKEN.
 */
@Injectable()
export class FonnteChannel implements NotificationChannel {
  readonly channelName = 'WHATSAPP' as const;

  private readonly logger = new Logger(FonnteChannel.name);
  private readonly apiUrl: string;
  private readonly apiToken: string | undefined;

  constructor(config: ConfigService) {
    this.apiUrl = config.get<string>('FONNTE_API_URL', 'https://api.fonnte.com/send');
    this.apiToken = config.get<string>('FONNTE_API_TOKEN');
  }

  async send(recipient: NotificationRecipient, message: string): Promise<SendResult> {
    if (!recipient.noHp) {
      return {
        success: false,
        errorMsg: 'Penerima tidak punya nomor HP — WA tidak bisa dikirim',
      };
    }

    // Sandbox mode: tanpa token, log saja (dev/CI/demo)
    if (!this.apiToken) {
      this.logger.log(`[SANDBOX — FONNTE_API_TOKEN kosong] WA ke ${recipient.noHp}: "${message}"`);
      return { success: true, providerRef: 'sandbox' };
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.apiToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target: recipient.noHp,
          message,
          countryCode: '62', // default Indonesia
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        status?: boolean;
        id?: string[] | string;
        reason?: string;
      };

      if (!response.ok || body.status === false) {
        const reason = body.reason ?? `HTTP ${response.status}`;
        this.logger.warn(`Fonnte gagal kirim ke ${recipient.noHp}: ${reason}`);
        return { success: false, errorMsg: `Fonnte: ${reason}` };
      }

      const providerRef = Array.isArray(body.id) ? body.id[0] : body.id;
      this.logger.log(`WA terkirim via Fonnte ke ${recipient.noHp} (ref: ${providerRef ?? '-'})`);
      return { success: true, providerRef };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Fonnte network error: ${msg}`);
      return { success: false, errorMsg: `Fonnte network error: ${msg}` };
    }
  }
}
