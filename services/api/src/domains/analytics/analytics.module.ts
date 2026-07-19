import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { FinanceModule } from '../finance/finance.module';
import { OrderModule } from '../order/order.module';
import { ProductionModule } from '../production/production.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CustomerModule } from '../customer/customer.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomerChatModule } from '../../common/customer-chat/customer-chat.module';

@Module({
  imports: [
    FinanceModule,
    OrderModule,
    ProductionModule,
    ShippingModule,
    CustomerModule,
    InventoryModule,
    CustomerChatModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
