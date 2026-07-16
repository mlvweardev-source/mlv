import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cookie parser — auth staff portal via httpOnly cookie (Fase 9)
  app.use(cookieParser());

  // CORS untuk apps/admin (port 4001) & apps/web (port 4000)
  // credentials: true agar cookie httpOnly ikut terkirim
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? [
      'http://localhost:4000',
      'http://localhost:4001',
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.NOTIFICATION_PORT || 3001;
  await app.listen(port);
  console.log(`[MLV Notification Worker] Running on http://localhost:${port}`);
}
bootstrap();
