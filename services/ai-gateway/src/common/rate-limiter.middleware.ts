import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { RateLimiter } from '@mlv/ai';

/**
 * Rate Limiter Middleware — 50 request/jam per pelanggan (keputusan #2 Fase 12)
 *
 * Middleware reusable yang bakal dipakai di semua endpoint AI customer-facing.
 * Menggunakan Redis counter dengan TTL (infrastruktur Redis sudah ada sejak Fase 6).
 *
 * Header yang diharapkan:
 * - X-Customer-ID: ID pelanggan (dari API gateway / auth middleware)
 *
 * Header yang dikembalikan:
 * - X-RateLimit-Limit: max request per window
 * - X-RateLimit-Remaining: sisa request
 * - X-RateLimit-Reset: detik sampai window reset
 */
@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimiterMiddleware.name);
  private readonly rateLimiter: RateLimiter;
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = this.configService.get<number>('REDIS_PORT', 6379);

    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    // 50 request/jam per pelanggan
    this.rateLimiter = new RateLimiter(this.redis, 50, 3600);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const customerId = (req.headers['x-customer-id'] as string) || 'anonymous';

    try {
      const result = await this.rateLimiter.check(customerId, 'ai');

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetInSeconds);

      if (!result.allowed) {
        this.logger.warn(
          `Rate limit exceeded for customer ${customerId}: ${result.current}/${result.limit}`,
        );
        throw new HttpException(
          {
            message: `Batas permintaan AI tercapai (${result.limit} per jam). Silakan coba lagi dalam ${result.resetInSeconds} detik.`,
            retryAfter: result.resetInSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If Redis is down, allow the request (fail-open for AI features)
      this.logger.error(`Rate limiter error (fail-open): ${(error as Error).message}`);
      next();
    }
  }
}
