import { Module, forwardRef } from '@nestjs/common';
import { OrderController } from './controllers/order.controller';
import { AiAssistantController } from './controllers/ai-assistant.controller';
import { OrderService } from './services/order.service';
import { AiAssistantService } from './services/ai-assistant.service';
import { OrderEventsProcessor } from './order-events.processor';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';

@Module({
  // InventoryModule: akses InventoryService (reservasi stok).
  // ProductionModule (forwardRef — circular): filter "order miliknya"
  // untuk Tim Penjahit via ProductionService.getOrderIdsForAssignee (§5.1).
  imports: [InventoryModule, forwardRef(() => ProductionModule)],
  controllers: [OrderController, AiAssistantController],
  providers: [OrderService, OrderEventsProcessor, AiAssistantService],
  exports: [OrderService, AiAssistantService],
})
export class OrderModule {}
