import { Module } from '@nestjs/common';
import { OrderController } from './controllers/order.controller';
import { OrderService } from './services/order.service';
import { OrderEventsProcessor } from './order-events.processor';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule], // Import InventoryModule untuk akses InventoryService
  controllers: [OrderController],
  providers: [OrderService, OrderEventsProcessor],
  exports: [OrderService],
})
export class OrderModule {}
