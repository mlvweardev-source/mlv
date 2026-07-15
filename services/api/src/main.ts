import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupBullBoard } from './event-bus/bull-board.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe for DTO validation (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // throw error on unknown properties
      transform: true, // auto-transform payloads to DTO instances
    }),
  );

  // Bull Board — monitoring queue BullMQ (§22), diamankan Basic Auth
  setupBullBoard(app);

  const port = process.env.API_PORT || 3000;
  await app.listen(port);
  console.log(`[MLV API] Running on http://localhost:${port}`);
}
bootstrap();
