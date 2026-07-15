import { Module } from '@nestjs/common';
import { FinanceService } from './services/finance.service';
import { FinanceEventListener } from './services/finance-event.listener';
import { PaymentController } from './controllers/payment.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { ApprovalController } from './controllers/approval.controller';
import { ProfitSharingController } from './controllers/profit-sharing.controller';
import { OrderModule } from '../order/order.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [OrderModule, InventoryModule, ProductionModule],
  controllers: [PaymentController, InvoiceController, ApprovalController, ProfitSharingController],
  providers: [FinanceService, FinanceEventListener],
  exports: [FinanceService],
})
export class FinanceModule {}
