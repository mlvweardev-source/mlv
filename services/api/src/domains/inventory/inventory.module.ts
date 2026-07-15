import { Module } from '@nestjs/common';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryService } from './services/inventory.service';
import { InventoryEventsProcessor } from './inventory-events.processor';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryEventsProcessor],
  exports: [InventoryService],
})
export class InventoryModule {}
