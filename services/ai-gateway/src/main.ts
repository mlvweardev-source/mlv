import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.AI_GATEWAY_PORT || 3002;
  await app.listen(port);
  console.log(`[MLV AI Gateway] Running on http://localhost:${port}`);
}
bootstrap();
