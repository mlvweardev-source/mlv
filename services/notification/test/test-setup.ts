import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { signJwt, UserRole, ActorType } from '@mlv/auth';

// Env vars are set by CI or .env loaded by ConfigModule
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-for-e2e';
if (!process.env.DATABASE_URL)
  process.env.DATABASE_URL = 'postgresql://mlv:mlv_secret@localhost:5432/mlv?schema=public';
if (!process.env.REDIS_HOST) process.env.REDIS_HOST = 'localhost';
if (!process.env.REDIS_PORT) process.env.REDIS_PORT = '6379';

const TEST_JWT_SECRET = process.env.JWT_SECRET;

export async function createNotificationTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

export function staffToken(userId: string, role: UserRole): string {
  return signJwt({ sub: userId, actorType: ActorType.USER, role }, TEST_JWT_SECRET, '1h');
}
