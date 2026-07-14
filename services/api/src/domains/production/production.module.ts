import { Module } from '@nestjs/common';
import { ProductionController } from './controllers/production.controller';
import { ProductionService } from './services/production.service';
import { OrderConfirmedListener } from './events/order-confirmed.listener';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [OrderModule], // Import untuk akses OrderService (DDD boundary)
  controllers: [ProductionController],
  providers: [ProductionService, OrderConfirmedListener],
  exports: [ProductionService],
})
export class ProductionModule {}
