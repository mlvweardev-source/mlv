import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { DesignAnalyzerController } from './design-analyzer.controller';
import { DesignAnalyzerService } from './design-analyzer.service';
import { RateLimiterMiddleware } from '../common/rate-limiter.middleware';

/**
 * Design Analyzer Module (Fase 12)
 *
 * Struktur per layanan AI (§9): setiap service punya prompt template
 * terpisah dan endpoint terpisah. Module ini untuk Design Analyzer.
 * Module AI lainnya (Quotation, Customer Support, dst) menyusul
 * di bagian-bagian berikutnya.
 */
@Module({
  controllers: [DesignAnalyzerController],
  providers: [DesignAnalyzerService],
  exports: [DesignAnalyzerService],
})
export class DesignAnalyzerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Rate limiter diterapkan ke semua endpoint di module ini
    consumer.apply(RateLimiterMiddleware).forRoutes('ai/design-analyzer');
  }
}
