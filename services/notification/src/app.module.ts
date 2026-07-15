import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '@mlv/types';
import { AppController } from './app.controller';
import { NotificationEventsProcessor } from './notification-events.processor';
import { DispatcherService } from './dispatcher/dispatcher.service';
import { NotificationController } from './dispatcher/notification.controller';
import { AuthGuard } from './auth/auth.guard';
import { NOTIFICATION_CHANNELS } from './channels/notification-channel.interface';
import { FonnteChannel } from './channels/fonnte.channel';
import { DashboardChannel } from './channels/dashboard.channel';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    // Subscribe queue notification-events — konsumen lintas proses
    // (event dari services/api melintasi Redis ke proses ini).
    BullModule.registerQueue({ name: QUEUES.NOTIFICATION_EVENTS }),
  ],
  controllers: [AppController, NotificationController],
  providers: [
    NotificationEventsProcessor,
    DispatcherService,
    FonnteChannel,
    DashboardChannel,
    // Daftar channel aktif — menambah channel baru (Email/Push/WA resmi)
    // = tambah class + entry di sini. Dispatcher & domain lain TIDAK berubah (§12).
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (fonnte: FonnteChannel, dashboard: DashboardChannel) => [fonnte, dashboard],
      inject: [FonnteChannel, DashboardChannel],
    },
    // Global AuthGuard — semua endpoint butuh JWT staff kecuali @Public()
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
