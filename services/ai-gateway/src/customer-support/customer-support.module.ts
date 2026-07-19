import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CustomerSupportController } from './customer-support.controller';
import { CustomerSupportService } from './customer-support.service';
import { RateLimiterMiddleware } from '../common/rate-limiter.middleware';

/**
 * Customer Support Module (Fase 12 Bagian 2, §9)
 *
 * AI menjawab pertanyaan pelanggan dari data order aktual. TIDAK query
 * balik ke domain lain — semua konteks ditaruh di request body (prinsip
 * Fase 8, sama seperti payload event Notification yang lengkap).
 *
 * Rate limit di-share dengan layanan AI lain (50/jam/pelanggan).
 */
@Module({
  controllers: [CustomerSupportController],
  providers: [CustomerSupportService],
  exports: [CustomerSupportService],
})
export class CustomerSupportModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimiterMiddleware).forRoutes('ai/customer-support');
  }
}
