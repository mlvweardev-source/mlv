import { Module } from '@nestjs/common';
import { ShippingController } from './controllers/shipping.controller';
import { ShippingService } from './services/shipping.service';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [OrderModule], // Import OrderModule untuk akses OrderService (DDD boundary)
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
