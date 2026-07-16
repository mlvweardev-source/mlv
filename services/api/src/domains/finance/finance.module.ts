import { Module } from '@nestjs/common';
import { FinanceService } from './services/finance.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { FinanceEventsProcessor } from './finance-events.processor';
import { PaymentController } from './controllers/payment.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { ApprovalController } from './controllers/approval.controller';
import { ProfitSharingController } from './controllers/profit-sharing.controller';
import { OrderModule } from '../order/order.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { CustomerModule } from '../customer/customer.module';
import { IdentityAccessModule } from '../identity-access/identity-access.module';

@Module({
  // CustomerModule & IdentityAccessModule (Fase 8): payload event
  // customer-facing wajib lengkap (nama/kontak) — diambil via service
  // method SEBELUM publish, bukan oleh Notification belakangan.
  imports: [OrderModule, InventoryModule, ProductionModule, CustomerModule, IdentityAccessModule],
  controllers: [PaymentController, InvoiceController, ApprovalController, ProfitSharingController],
  providers: [FinanceService, InvoicePdfService, FinanceEventsProcessor],
  exports: [FinanceService],
})
export class FinanceModule {}
