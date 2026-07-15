import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '@mlv/types';
import { AppController } from './app.controller';
import { NotificationEventsProcessor } from './notification-events.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    // Fase 6: subscribe ke queue notification-events — konsumen lintas
    // proses (event dari services/api melintasi Redis ke proses ini).
    BullModule.registerQueue({ name: QUEUES.NOTIFICATION_EVENTS }),
  ],
  controllers: [AppController],
  providers: [NotificationEventsProcessor],
})
export class AppModule {}
