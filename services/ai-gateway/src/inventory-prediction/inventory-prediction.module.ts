import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { InventoryPredictionController } from './inventory-prediction.controller';
import { InventoryPredictionService } from './inventory-prediction.service';
import { RateLimiterMiddleware } from '../common/rate-limiter.middleware';

@Module({
  controllers: [InventoryPredictionController],
  providers: [InventoryPredictionService],
  exports: [InventoryPredictionService],
})
export class InventoryPredictionModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimiterMiddleware).forRoutes('ai/inventory-prediction');
  }
}
