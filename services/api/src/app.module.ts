import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { EventBusModule } from './event-bus/event-bus.module';
import { IdentityAccessModule } from './domains/identity-access/identity-access.module';
import { CustomerModule } from './domains/customer/customer.module';
import { InventoryModule } from './domains/inventory/inventory.module';
import { OrderModule } from './domains/order/order.module';
import { ProductionModule } from './domains/production/production.module';
import { FinanceModule } from './domains/finance/finance.module';
import { AuthGuard } from './domains/identity-access/guards/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    // Fase 6: EventEmitterModule (in-process) digantikan EventBusModule
    // (Redis + BullMQ, §7) — event lintas domain & lintas proses.
    EventBusModule,
    IdentityAccessModule,
    CustomerModule,
    InventoryModule,
    OrderModule,
    ProductionModule,
    FinanceModule,
  ],
  controllers: [AppController],
  providers: [
    // Global AuthGuard — diterapkan ke semua endpoint kecuali yang ditandai @Public()
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
