import { AppError } from './errors';

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

export class RateLimiter {
  /**
   * Sliding window in-memory rate limiter.
   * Throws 429 RATE_LIMITED if the limit is exceeded in the time window.
   */
  check(key: string, limit = 60, windowMs = 60_000): { remaining: number; resetAt: number } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let record = rateLimitStore.get(key);
    if (!record) {
      record = { timestamps: [] };
      rateLimitStore.set(key, record);
    }

    // Filter out timestamps outside the sliding window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= limit) {
      const oldest = record.timestamps[0];
      const resetAt = oldest + windowMs;
      throw new AppError(
        'RATE_LIMITED',
        `Rate limit exceeded. Please try again in ${Math.ceil((resetAt - now) / 1000)} seconds.`
      );
    }

    record.timestamps.push(now);
    const remaining = limit - record.timestamps.length;
    const resetAt = now + windowMs;

    return { remaining, resetAt };
  }

  reset(key: string): void {
    rateLimitStore.delete(key);
  }

  clear(): void {
    rateLimitStore.clear();
  }
}

export const rateLimiter = new RateLimiter();
