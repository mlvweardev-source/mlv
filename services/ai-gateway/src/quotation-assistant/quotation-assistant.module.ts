import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { QuotationAssistantController } from './quotation-assistant.controller';
import { QuotationAssistantService } from './quotation-assistant.service';
import { RateLimiterMiddleware } from '../common/rate-limiter.middleware';

/**
 * Quotation Assistant Module (Fase 12 Bagian 2)
 *
 * AI HANYA memberi saran harga (§17.4) — tidak pernah auto-apply.
 * Rate limit di-share dengan Design Analyzer (50/jam/pelanggan).
 */
@Module({
  controllers: [QuotationAssistantController],
  providers: [QuotationAssistantService],
  exports: [QuotationAssistantService],
})
export class QuotationAssistantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimiterMiddleware).forRoutes('ai/quotation-assistant');
  }
}
