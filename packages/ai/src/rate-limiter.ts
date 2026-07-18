import Redis from 'ioredis';

/**
 * Rate Limiter — Redis-based, per customer (§17, keputusan #2 Fase 12)
 *
 * 50 request/jam per pelanggan untuk fitur AI customer-facing.
 * Pakai Redis INCR + EXPIRE (atomic, satu key per customer per window).
 *
 * Dipakai sebagai middleware/guard reusable — siap untuk layanan AI berikutnya
 * (Quotation Assistant, Customer Support, dst).
 */

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  /** Detik sampai window reset */
  resetInSeconds: number;
}

export class RateLimiter {
  private readonly redis: Redis;
  private readonly limit: number;
  private readonly windowSeconds: number;

  /**
   * @param redis — ioredis instance
   * @param limit — max request per window (default: 50)
   * @param windowSeconds — window duration in seconds (default: 3600 = 1 jam)
   */
  constructor(redis: Redis, limit = 50, windowSeconds = 3600) {
    this.redis = redis;
    this.limit = limit;
    this.windowSeconds = windowSeconds;
  }

  /**
   * Check and consume one rate limit slot for a customer.
   *
   * Uses a sliding-window-inspired approach with fixed window:
   * - Key: `ratelimit:{service}:{customerId}`
   * - INCR + EXPIRE on first hit in window
   * - Returns remaining count and TTL
   */
  async check(customerId: string, service = 'ai'): Promise<RateLimitResult> {
    const key = `ratelimit:${service}:${customerId}`;

    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();

    const count = (results?.[0]?.[1] as number) ?? 0;
    let ttl = (results?.[1]?.[1] as number) ?? -1;

    // Set expiry on first hit in this window
    if (ttl === -1) {
      await this.redis.expire(key, this.windowSeconds);
      ttl = this.windowSeconds;
    }

    // ttl = -2 means key doesn't exist (shouldn't happen after INCR, but defensive)
    if (ttl < 0) ttl = this.windowSeconds;

    const remaining = Math.max(0, this.limit - count);

    return {
      allowed: count <= this.limit,
      current: count,
      limit: this.limit,
      remaining,
      resetInSeconds: ttl,
    };
  }
}
