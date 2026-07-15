import { Module } from '@nestjs/common';
import { ProductionController } from './controllers/production.controller';
import { ProductionService } from './services/production.service';
import { ProductionEventsProcessor } from './production-events.processor';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [OrderModule], // Import untuk akses OrderService (DDD boundary)
  controllers: [ProductionController],
  providers: [ProductionService, ProductionEventsProcessor],
  exports: [ProductionService],
})
export class ProductionModule {}
