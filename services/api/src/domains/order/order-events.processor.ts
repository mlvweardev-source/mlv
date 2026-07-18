import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, EVENT_NAMES } from '@mlv/types';
import { OrderService } from './services/order.service';

/**
 * Order Events Processor — Consumer BullMQ queue `order-events` (§4, §7)
 *
 * Menggantikan OrderEventListener (EventEmitter2) dari Fase 5.
 * Event dikonsumsi: PaymentSucceeded, PaymentExpired, ProductionCompleted,
 * StockReservationFailed (§4 — publisher-nya belum ada, wajar Fase 6).
 *
 * Idempotency (§16): TIDAK mengandalkan dedup BullMQ — setiap handler
 * di OrderService cek state DB dulu sebelum apply efek.
 * Error dilempar ulang supaya BullMQ retry (3x exponential backoff);
 * gagal permanen masuk state `failed` (DLQ) — pantau via Bull Board.
 */
@Injectable()
@Processor(QUEUES.ORDER_EVENTS)
export class OrderEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderEventsProcessor.name);

  constructor(private readonly orderService: OrderService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing ${job.name} (job ${job.id}, attempt ${job.attemptsMade + 1})`);

    switch (job.name) {
      case EVENT_NAMES.PaymentSucceeded:
        await this.orderService.handlePaymentSucceeded(job.data);
        break;

      case EVENT_NAMES.PaymentExpired:
        // Fase 11: payment expired → cancel order (release stok via inventory-events)
        await this.orderService.handlePaymentExpired(job.data);
        break;

      case EVENT_NAMES.ProductionCompleted:
        await this.orderService.handleProductionCompleted(job.data);
        break;

      case EVENT_NAMES.ShipmentCreated:
        await this.orderService.handleShipmentCreated(job.data);
        break;

      case EVENT_NAMES.ShipmentDelivered:
        await this.orderService.handleShipmentDelivered(job.data);
        break;

      case EVENT_NAMES.StockReservationFailed:
        // Publisher belum ada (§4) — placeholder untuk fase berikutnya
        this.logger.warn(`StockReservationFailed diterima tapi belum ada handler: ${job.id}`);
        break;

      default:
        this.logger.warn(`Unknown event "${job.name}" di queue ${QUEUES.ORDER_EVENTS} — skipped`);
    }
  }
}
