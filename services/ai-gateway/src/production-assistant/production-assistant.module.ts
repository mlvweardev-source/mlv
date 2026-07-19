import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ProductionAssistantController } from './production-assistant.controller';
import { ProductionAssistantService } from './production-assistant.service';
import { RateLimiterMiddleware } from '../common/rate-limiter.middleware';

@Module({
  controllers: [ProductionAssistantController],
  providers: [ProductionAssistantService],
  exports: [ProductionAssistantService],
})
export class ProductionAssistantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimiterMiddleware).forRoutes('ai/production-assistant');
  }
}
