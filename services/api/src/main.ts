import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { setupBullBoard } from './event-bus/bull-board.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cookie parser — auth staf portal via httpOnly cookie (Fase 9)
  app.use(cookieParser());

  // Serve file desain yang diupload (local disk, Fase 3) agar bisa
  // ditampilkan di portal admin. Swap ke S3-compatible storage nanti.
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  // CORS untuk apps/admin (port 4001) & apps/web (port 4000).
  // credentials: true wajib agar cookie httpOnly ikut terkirim.
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? [
      'http://localhost:4000',
      'http://localhost:4001',
    ],
    credentials: true,
  });

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
