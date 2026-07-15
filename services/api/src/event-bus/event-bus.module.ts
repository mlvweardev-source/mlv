import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ALL_QUEUES } from '@mlv/types';
import { EventBusService } from './event-bus.service';

/**
 * Event Bus Module — Infrastruktur BullMQ (§7, §18)
 *
 * @Global: EventBusService bisa di-inject di semua domain module
 * tanpa import berulang (pengganti EventEmitterModule.forRoot()).
 *
 * Registrasi queue: satu queue per domain konsumen (§4).
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [EventBusService],
  exports: [EventBusService, BullModule],
})
export class EventBusModule {}
