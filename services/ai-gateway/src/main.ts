import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS — ai-gateway dipanggil oleh services/api (internal) dan mungkin apps/web
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  });

  const port = process.env.AI_GATEWAY_PORT || 3002;
  await app.listen(port);
  console.log(`[MLV AI Gateway] Running on http://localhost:${port}`);
}
bootstrap();
