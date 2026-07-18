import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { prisma } from '@mlv/db';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../event-bus/event-bus.service';
import { CustomerService } from '../../domains/customer/services/customer.service';
import { OrderService } from '../../domains/order/services/order.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Reservation Expiry Processor — BullMQ repeatable job (Fase 11)
 *
 * Berjalan setiap 15 menit (interval wajar, tidak perlu real-time presisi).
 * Mencari stock_reservations ACTIVE dengan expires_at yang sudah lewat,
 * lalu untuk setiap order terkait:
 *   1. Release semua reservasi ACTIVE (idempotent via InventoryService)
 *   2. Set order → DIBATALKAN (idempotent: skip jika bukan MENUNGGU_PEMBAYARAN_DP)
 *   3. Publish ReservationExpired event → notification-events (WA ke pelanggan)
 *
 * Dua jalur (job ini + webhook expire) harus idempoten satu sama lain:
 * - Job ini cek reservasi masih ACTIVE sebelum release
 * - Webhook expire juga me-publish PaymentExpired → InventoryEventsProcessor
 *   yang juga cek reservasi masih ACTIVE
 * - cancelOrderByFinance skip jika order sudah bukan MENUNGGU_PEMBAYARAN_DP
 */
@Injectable()
@Processor('reservation-expiry')
export class ReservationExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservationExpiryProcessor.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly customerService: CustomerService,
    private readonly orderService: OrderService,
    private readonly activityLog: ActivityLogService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Running reservation expiry check (job ${job.id})`);

    // Cari semua reservasi ACTIVE yang sudah kadaluarsa
    const expiredReservations = await prisma.stockReservation.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
      },
      select: { orderId: true },
      distinct: ['orderId'],
    });

    if (expiredReservations.length === 0) {
      this.logger.log('No expired reservations found');
      return;
    }

    this.logger.log(`Found ${expiredReservations.length} order(s) with expired reservations`);

    let processed = 0;
    let skipped = 0;

    for (const { orderId } of expiredReservations) {
      try {
        // Cek status order — hanya proses yang masih MENUNGGU_PEMBAYARAN_DP
        const order = await prisma.order.findUnique({
          where: { id: orderId },
        });

        if (!order) {
          this.logger.warn(`Order ${orderId} not found — skipping`);
          skipped++;
          continue;
        }

        if (order.status !== 'MENUNGGU_PEMBAYARAN_DP') {
          this.logger.log(
            `Order ${order.orderNumber} status sudah ${order.status} — skip (idempotent no-op)`,
          );
          skipped++;
          continue;
        }

        // 1. Release semua reservasi ACTIVE (idempotent)
        const releasedCount = await this.orderService.releaseReservationsForOrder(orderId);
        this.logger.log(`Released ${releasedCount} reservations for order ${order.orderNumber}`);

        // 2. Cancel order
        await this.orderService.cancelOrderByFinance(
          orderId,
          'Reservasi kadaluarsa — DP tidak dibayar dalam 24 jam',
        );

        // 3. Publish ReservationExpired event → notification-events (WA)
        const customer = await this.customerService.getCustomerByIdInternal(order.customerId);
        await this.eventBus.publish(EVENT_NAMES.ReservationExpired, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          customerNama: customer?.nama ?? 'Pelanggan',
          customerNoHp: customer?.noHp ?? null,
        });

        // 4. Activity log
        await this.activityLog.log(
          null,
          'SYSTEM',
          `Order ${order.orderNumber} dibatalkan otomatis — reservasi kadaluarsa (DP tidak dibayar dalam 24 jam)`,
          'Order',
          order.id,
        );

        processed++;
        this.logger.log(`Order ${order.orderNumber} cancelled due to reservation expiry`);
      } catch (error) {
        this.logger.error(`Failed to process expiry for order ${orderId}: ${error}`);
        // Biar BullMQ retry
        throw error;
      }
    }

    this.logger.log(`Expiry check done: ${processed} processed, ${skipped} skipped`);
  }
}
