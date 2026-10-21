import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimiter, getTrustworthyClientIp } from '@/src/lib/rate-limit';

describe('Sliding Window Rate Limiter & Trusted Client Identification', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(5); // Small capacity to verify bounding
  });

  describe('Threshold Enforcement', () => {
    it('allows requests within the defined threshold', () => {
      const key = 'test-user-1';
      for (let i = 0; i < 5; i++) {
        const result = limiter.check(key, 5, 10_000);
        expect(result.remaining).toBe(5 - (i + 1));
      }
    });

    it('throws RATE_LIMITED (429) when threshold is exceeded', () => {
      const key = 'test-user-2';
      limiter.check(key, 3, 10_000);
      limiter.check(key, 3, 10_000);
      limiter.check(key, 3, 10_000);

      expect(() => limiter.check(key, 3, 10_000)).toThrowError(/Rate limit exceeded/);
    });

    it('resets a specific key correctly', () => {
      const key = 'test-user-3';
      limiter.check(key, 1, 10_000);
      expect(() => limiter.check(key, 1, 10_000)).toThrowError();

      limiter.reset(key);
      expect(() => limiter.check(key, 1, 10_000)).not.toThrow();
    });
  });

  describe('Bounded Memory Protection & Eviction', () => {
    it('enforces maximum store capacity and evicts oldest entries to prevent memory exhaustion', () => {
      // Bounded capacity is 5
      for (let i = 0; i < 10; i++) {
        limiter.check(`key-${i}`, 10, 60_000);
      }

      // Store size should never exceed the configured maxEntries bound (5)
      expect(limiter.size).toBeLessThanOrEqual(5);
    });
  });

  describe('Trustworthy Client IP Resolution', () => {
    const originalTrustedHeader = process.env.TRUSTED_IP_HEADER;

    afterEach(() => {
      process.env.TRUSTED_IP_HEADER = originalTrustedHeader;
    });

    it('prioritizes x-vercel-forwarded-for set by Vercel Edge Proxy over client-supplied headers', () => {
      const req = {
        headers: new Headers({
          'x-vercel-forwarded-for': '198.51.100.42',
          'x-real-ip': '203.0.113.195',
          'x-forwarded-for': '1.1.1.1',
        }),
      };
      expect(getTrustworthyClientIp(req as any)).toBe('198.51.100.42');
    });

    it('handles comma-separated list in x-vercel-forwarded-for, picking the edge-verified IP', () => {
      const req = {
        headers: new Headers({
          'x-vercel-forwarded-for': '10.0.0.1, 198.51.100.42',
        }),
      };
      expect(getTrustworthyClientIp(req as any)).toBe('198.51.100.42');
    });

    it('rejects untrusted headers (cf-connecting-ip, x-real-ip, x-forwarded-for) without guaranteed ingress, returning "unknown"', () => {
      // Direct client sending spoofed proxy headers to Vercel without x-vercel-forwarded-for
      const req = {
        headers: new Headers({
          'cf-connecting-ip': '198.51.100.99',
          'x-real-ip': '203.0.113.195',
          'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        }),
      };
      expect(getTrustworthyClientIp(req as any)).toBe('unknown');
    });

    it('honors explicitly configured TRUSTED_IP_HEADER when specified in deployment environment', () => {
      process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
      const req = {
        headers: new Headers({
          'cf-connecting-ip': '198.51.100.99',
          'x-forwarded-for': '1.2.3.4',
        }),
      };
      expect(getTrustworthyClientIp(req as any)).toBe('198.51.100.99');
    });

    it('falls back to "unknown" when headers are absent, empty, or malformed', () => {
      const reqEmpty = { headers: new Headers() };
      expect(getTrustworthyClientIp(reqEmpty as any)).toBe('unknown');

      const reqMalformed = {
        headers: new Headers({
          'x-vercel-forwarded-for': 'invalid-not-an-ip',
        }),
      };
      expect(getTrustworthyClientIp(reqMalformed as any)).toBe('unknown');
    });
  });
});
