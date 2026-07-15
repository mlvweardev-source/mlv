import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProductionService } from '../services/production.service';
import { OrderConfirmedEvent } from '../../order/events/order.events';

/**
 * OrderConfirmed Event Listener
 *
 * Listen untuk event OrderConfirmed dan trigger task generation.
 * §7.1: Memicu creation of production_tasks sesuai routing produk.
 */
@Injectable()
export class OrderConfirmedListener {
  private readonly logger = new Logger(OrderConfirmedListener.name);

  constructor(private readonly productionService: ProductionService) {}

  @OnEvent(OrderConfirmedEvent.eventName)
  async handleOrderConfirmed(event: OrderConfirmedEvent) {
    this.logger.log(`Received OrderConfirmed event for order ${event.orderNumber}`);

    try {
      await this.productionService.handleOrderConfirmed(
        event.orderId,
        event.orderNumber,
        event.customerId,
      );
      this.logger.log(`Task generation completed for order ${event.orderNumber}`);
    } catch (error) {
      this.logger.error(`Failed to generate tasks for order ${event.orderNumber}: ${error}`);
      // Tidak throw — event processing harus idempotent dan tidak crash subscriber lain
    }
  }
}
