import { Module } from '@nestjs/common';
import { CustomerChatController } from './customer-chat.controller';
import { CustomerChatService } from './customer-chat.service';
import { IdentityAccessModule } from '../../domains/identity-access/identity-access.module';
import { CustomerModule } from '../../domains/customer/customer.module';
import { OrderModule } from '../../domains/order/order.module';
import { FinanceModule } from '../../domains/finance/finance.module';
import { ShippingModule } from '../../domains/shipping/shipping.module';

@Module({
  // Fase 12 Bagian 2 (koreksi DDD §4.1): CustomerChatService butuh akses
  // ke SERVICE METHOD dari 3 domain (Order, Finance, Shipping) untuk
  // bangun konteks AI auto-reply — TIDAK query prisma langsung lintas domain.
  // - OrderModule: getOrderByIdInternal, getOrderContextForAi
  // - FinanceModule: getPaymentsForOrder, getInvoicesForOrder
  // - ShippingModule: getShipmentForOrder
  imports: [IdentityAccessModule, CustomerModule, OrderModule, FinanceModule, ShippingModule],
  controllers: [CustomerChatController],
  providers: [CustomerChatService],
  exports: [CustomerChatService],
})
export class CustomerChatModule {}
