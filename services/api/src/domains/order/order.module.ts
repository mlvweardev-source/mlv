import { Module } from '@nestjs/common';
import { OrderController } from './controllers/order.controller';
import { OrderService } from './services/order.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule], // Import InventoryModule untuk akses InventoryService
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
