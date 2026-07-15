import { Module } from '@nestjs/common';
import { ProductionController } from './controllers/production.controller';
import { ProductionService } from './services/production.service';
import { ProductionEventsProcessor } from './production-events.processor';
import { OrderModule } from '../order/order.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  // CustomerModule (Fase 8): payload ProductionCompleted wajib lengkap
  // (nama/kontak pelanggan) — diambil via CustomerService sebelum publish.
  imports: [OrderModule, CustomerModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionEventsProcessor],
  exports: [ProductionService],
})
export class ProductionModule {}
