import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { IdentityAccessModule } from './domains/identity-access/identity-access.module';
import { CustomerModule } from './domains/customer/customer.module';
import { InventoryModule } from './domains/inventory/inventory.module';
import { OrderModule } from './domains/order/order.module';
import { AuthGuard } from './domains/identity-access/guards/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    EventEmitterModule.forRoot(),
    IdentityAccessModule,
    CustomerModule,
    InventoryModule,
    OrderModule,
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
