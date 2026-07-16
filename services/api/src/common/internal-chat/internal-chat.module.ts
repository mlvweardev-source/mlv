import { Module } from '@nestjs/common';
import { InternalChatController } from './internal-chat.controller';
import { InternalChatService } from './internal-chat.service';
import { IdentityAccessModule } from '../../domains/identity-access/identity-access.module';

@Module({
  imports: [IdentityAccessModule],
  controllers: [InternalChatController],
  providers: [InternalChatService],
  exports: [InternalChatService],
})
export class InternalChatModule {}
