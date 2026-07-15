import { Module } from '@nestjs/common';
import { ShippingController } from './controllers/shipping.controller';
import { ShippingService } from './services/shipping.service';
import { OrderModule } from '../order/order.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  // OrderModule: akses OrderService (DDD boundary).
  // CustomerModule (Fase 8): payload ShipmentCreated wajib lengkap
  // (nama/kontak pelanggan) — diambil via CustomerService sebelum publish.
  imports: [OrderModule, CustomerModule],
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
