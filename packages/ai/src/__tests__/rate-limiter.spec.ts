import { RateLimiter } from '../rate-limiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockRedis: {
    pipeline: jest.Mock;
    expire: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      pipeline: jest.fn(),
      expire: jest.fn(),
    };

    rateLimiter = new RateLimiter(mockRedis as any, 50, 3600);
  });

  it('should allow request within limit', async () => {
    const mockExec = jest.fn().mockResolvedValue([
      [null, 1], // INCR result
      [null, 3600], // TTL result
    ]);
    mockRedis.pipeline.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: mockExec,
    });

    const result = await rateLimiter.check('customer-1', 'ai');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.remaining).toBe(49);
    expect(result.limit).toBe(50);
  });

  it('should deny request when limit exceeded', async () => {
    const mockExec = jest.fn().mockResolvedValue([
      [null, 51], // INCR result — over limit
      [null, 1800], // TTL result
    ]);
    mockRedis.pipeline.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: mockExec,
    });

    const result = await rateLimiter.check('customer-1', 'ai');

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(51);
    expect(result.remaining).toBe(0);
  });

  it('should set expiry on first hit', async () => {
    const mockExec = jest.fn().mockResolvedValue([
      [null, 1], // INCR result
      [null, -1], // TTL = -1 means no expiry set
    ]);
    mockRedis.pipeline.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: mockExec,
    });
    mockRedis.expire.mockResolvedValue(1);

    const result = await rateLimiter.check('customer-1', 'ai');

    expect(mockRedis.expire).toHaveBeenCalledWith('ratelimit:ai:customer-1', 3600);
    expect(result.allowed).toBe(true);
  });

  it('should use correct key format', async () => {
    const mockExec = jest.fn().mockResolvedValue([
      [null, 1],
      [null, 3600],
    ]);
    const mockIncr = jest.fn().mockReturnThis();
    mockRedis.pipeline.mockReturnValue({
      incr: mockIncr,
      ttl: jest.fn().mockReturnThis(),
      exec: mockExec,
    });

    await rateLimiter.check('customer-123', 'design-analyzer');

    expect(mockIncr).toHaveBeenCalledWith('ratelimit:design-analyzer:customer-123');
  });
});
