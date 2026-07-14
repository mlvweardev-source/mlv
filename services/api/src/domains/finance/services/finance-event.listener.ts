import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FinanceService } from './finance.service';
import { PaymentSucceededEvent } from '../events/finance.events';
import { ProductionCompletedEvent } from '../../production/events/production.events';

/**
 * Finance Event Listeners
 *
 * Listen untuk events dari domain lain dan reaksikan sesuai kebutuhan Finance.
 */
@Injectable()
export class FinanceEventListener implements OnModuleInit {
  private readonly logger = new Logger(FinanceEventListener.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly financeService: FinanceService,
  ) {}

  onModuleInit() {
    // Listen to ProductionCompleted → generate Pelunasan invoice
    this.eventEmitter.on(
      ProductionCompletedEvent.eventName,
      (event: ProductionCompletedEvent) => {
        this.logger.log(`Received ProductionCompleted for order ${event.orderNumber}`);
        this.financeService.onProductionCompleted(event.orderId);
      },
    );

    this.logger.log('FinanceEventListener registered');
  }
}
