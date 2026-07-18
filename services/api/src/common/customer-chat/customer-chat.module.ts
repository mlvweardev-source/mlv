import { Module } from '@nestjs/common';
import { CustomerChatController } from './customer-chat.controller';
import { CustomerChatService } from './customer-chat.service';
import { IdentityAccessModule } from '../../domains/identity-access/identity-access.module';
import { CustomerModule } from '../../domains/customer/customer.module';

@Module({
  imports: [IdentityAccessModule, CustomerModule],
  controllers: [CustomerChatController],
  providers: [CustomerChatService],
  exports: [CustomerChatService],
})
export class CustomerChatModule {}
