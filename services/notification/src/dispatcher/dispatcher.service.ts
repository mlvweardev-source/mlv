import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { prisma } from '@mlv/db';
import type { NotificationChannel as PrismaChannelEnum } from '@mlv/db';
import {
  NOTIFICATION_CHANNELS,
  NotificationChannel,
  NotificationRecipient,
} from '../channels/notification-channel.interface';

/**
 * Hasil dispatch satu event — dipakai processor & endpoint manual.
 */
export interface DispatchSummary {
  eventType: string;
  templatesFound: number;
  sent: number;
  failed: number;
  skippedDuplicate: number;
}

/**
 * DispatcherService — alur §12:
 *
 *   Event masuk (queue notification-events)
 *     → cari notification_templates berdasarkan event_type (+channel aktif)
 *     → render template dengan data payload event (payload SUDAH lengkap —
 *       domain penerbit yang melengkapi, bukan kita memanggil balik)
 *     → kirim lewat channel yang sesuai (interface generik)
 *     → catat hasil ke notification_logs (SENT/FAILED)
 *
 * Idempotency (§16): dedup_key = hash(eventType + channel + payload).
 * Event duplikat (BullMQ retry / publish ulang) tidak menghasilkan
 * pesan WA ganda — cek state DB dulu, pola yang sama dengan konsumen
 * Order/Production/Finance/Inventory di Fase 6.
 *
 * PENTING (prinsip Fase 8): service ini TIDAK PERNAH memanggil balik
 * service domain lain (proses beda = network hop = coupling baru).
 * Satu-satunya data yang dibaca dari DB adalah tabel MILIK Notification
 * Domain sendiri (notification_templates, notification_logs).
 */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);
  private readonly channelMap: Map<PrismaChannelEnum, NotificationChannel>;

  constructor(@Inject(NOTIFICATION_CHANNELS) channels: NotificationChannel[]) {
    this.channelMap = new Map(channels.map((c) => [c.channelName, c]));
  }

  /**
   * Dispatch event → semua template aktif untuk event_type tsb.
   */
  async dispatchEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<DispatchSummary> {
    const summary: DispatchSummary = {
      eventType,
      templatesFound: 0,
      sent: 0,
      failed: 0,
      skippedDuplicate: 0,
    };

    const templates = await prisma.notificationTemplate.findMany({
      where: { eventType, isActive: true },
    });
    summary.templatesFound = templates.length;

    if (templates.length === 0) {
      // Wajar: tidak semua event punya template (§7.1 hanya sebagian
      // event yang customer/staff-facing).
      return summary;
    }

    for (const template of templates) {
      const channel = this.channelMap.get(template.channel);
      if (!channel) {
        // Template untuk channel yang belum diimplementasikan
        // (EMAIL/PUSH menyusul) — skip tanpa error, §12: nambah channel
        // baru tidak mengubah kode manapun selain daftar channel.
        this.logger.warn(
          `Template ${template.id} channel ${template.channel} belum ada implementasinya — skip`,
        );
        continue;
      }

      const message = this.renderTemplate(template.templateBody, payload);
      const recipient = this.resolveRecipient(template.channel, payload);
      const dedupKey = this.buildDedupKey(eventType, template.channel, payload);

      // Idempotency: event yang sama tidak dikirim dua kali
      const existing = await prisma.notificationLog.findFirst({
        where: { dedupKey, statusKirim: 'SENT' },
      });
      if (existing) {
        this.logger.log(
          `Duplikat ${eventType}/${template.channel} (dedup ${dedupKey.slice(0, 12)}…) — skip (idempotent no-op)`,
        );
        summary.skippedDuplicate++;
        continue;
      }

      const result = await channel.send(recipient, message);

      await prisma.notificationLog.create({
        data: {
          customerId: recipient.customerId,
          userId: recipient.userId,
          orderId: (payload.orderId as string | undefined) ?? null,
          eventType,
          channel: template.channel,
          pesan: message,
          statusKirim: result.success ? 'SENT' : 'FAILED',
          errorMsg: result.errorMsg ?? null,
          dedupKey,
        },
      });

      if (result.success) {
        summary.sent++;
      } else {
        summary.failed++;
        this.logger.warn(
          `Gagal kirim ${eventType} via ${template.channel}: ${result.errorMsg ?? 'unknown'}`,
        );
      }
    }

    this.logger.log(
      `Dispatch ${eventType}: ${summary.sent} terkirim, ${summary.failed} gagal, ` +
        `${summary.skippedDuplicate} duplikat (dari ${summary.templatesFound} template)`,
    );

    return summary;
  }

  /**
   * Render {{placeholder}} dari payload event.
   * Angka diformat id-ID (Rp 300.000 bukan 300000).
   * Placeholder tanpa nilai → "-" (bukan error; template bisa lebih
   * lengkap dari payload event lama).
   */
  renderTemplate(templateBody: string, payload: Record<string, unknown>): string {
    return templateBody.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = payload[key];
      if (value === undefined || value === null) return '-';
      if (typeof value === 'number') return value.toLocaleString('id-ID');
      return String(value);
    });
  }

  /**
   * Tentukan penerima berdasar channel:
   * - WHATSAPP (customer-facing): kontak DARI PAYLOAD (customerNoHp) —
   *   payload wajib lengkap, kita tidak mencari ke domain lain.
   * - DASHBOARD (internal): broadcast staff (userId null) — sesuai §5.1
   *   Owner/Manajer lihat semua; notifikasi per-penjahit menyusul saat
   *   ada event yang menargetkan penjahit spesifik.
   */
  private resolveRecipient(
    channel: PrismaChannelEnum,
    payload: Record<string, unknown>,
  ): NotificationRecipient {
    if (channel === 'WHATSAPP' || channel === 'EMAIL') {
      return {
        customerId: (payload.customerId as string | undefined) ?? null,
        userId: null,
        noHp: (payload.customerNoHp as string | undefined) ?? null,
        email: (payload.customerEmail as string | undefined) ?? null,
      };
    }

    // DASHBOARD / PUSH — internal
    return {
      customerId: null,
      userId: (payload.targetUserId as string | undefined) ?? null,
      noHp: null,
      email: null,
    };
  }

  private buildDedupKey(
    eventType: string,
    channel: PrismaChannelEnum,
    payload: Record<string, unknown>,
  ): string {
    // Timestamp field (createdAt/completedAt/…) ikut di-hash — dua event
    // BERBEDA utk order yang sama (mis. dua kali StockLow) tetap terkirim;
    // yang di-dedup adalah publish ULANG event yang identik.
    const raw = JSON.stringify({ eventType, channel, payload });
    return createHash('sha256').update(raw).digest('hex');
  }
}
