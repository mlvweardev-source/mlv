import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.NOTIFICATION_PORT || 3001;
  await app.listen(port);
  console.log(`[MLV Notification Worker] Running on http://localhost:${port}`);
}
bootstrap();
