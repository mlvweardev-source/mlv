import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReservationExpiryProcessor } from './reservation-expiry.processor';
import { ReservationExpiryScheduler } from './reservation-expiry.scheduler';
import { OrderModule } from '../../domains/order/order.module';
import { CustomerModule } from '../../domains/customer/customer.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

const RESERVATION_EXPIRY_QUEUE = 'reservation-expiry';

/**
 * Reservation Expiry Module (Fase 11)
 *
 * BullMQ repeatable job yang memeriksa reservasi kadaluarsa setiap 15 menit.
 * Menggunakan service dari Order, Customer, dan ActivityLog domain.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: RESERVATION_EXPIRY_QUEUE }),
    OrderModule,
    CustomerModule,
    ActivityLogModule,
  ],
  providers: [ReservationExpiryProcessor, ReservationExpiryScheduler],
})
export class ReservationExpiryModule {}
