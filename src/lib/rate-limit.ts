import { AppError } from './errors';

interface RateLimitRecord {
  timestamps: number[];
}

/**
 * ARCHITECTURAL NOTICE:
 * This in-memory sliding-window rate limiter operates as DEFENSE-IN-DEPTH on the local
 * runtime container. In distributed or serverless environments (such as Vercel Functions),
 * each container maintains its own memory space. This provides effective per-instance
 * burst suppression, but is not a globally synchronized cluster-wide limiter.
 *
 * For strict cluster-wide rate limiting across horizontal serverless instances, configure
 * a distributed key-value store (such as Upstash Redis).
 */
export class RateLimiter {
  private store: Map<string, RateLimitRecord>;
  private maxEntries: number;

  constructor(maxEntries = 5000) {
    this.store = new Map<string, RateLimitRecord>();
    this.maxEntries = maxEntries;
  }

  /**
   * Evaluates if a key is within the sliding window limit.
   * Throws 429 RATE_LIMITED if exceeded.
   */
  check(key: string, limit = 60, windowMs = 60_000): { remaining: number; resetAt: number } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let record = this.store.get(key);

    if (record) {
      // Filter timestamps outside the sliding window
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
    } else {
      // Ensure the store does not grow without bound
      if (this.store.size >= this.maxEntries) {
        this.pruneStaleEntries(now, windowMs);
      }

      // If still at capacity, evict the oldest key (FIFO / LRU-like eviction)
      if (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey !== undefined) {
          this.store.delete(oldestKey);
        }
      }

      record = { timestamps: [] };
      this.store.set(key, record);
    }

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

  /**
   * Evicts keys with empty or completely expired timestamps to reclaim memory.
   */
  private pruneStaleEntries(now: number, windowMs: number): void {
    const windowStart = now - windowMs;
    for (const [key, rec] of this.store.entries()) {
      rec.timestamps = rec.timestamps.filter((ts) => ts > windowStart);
      if (rec.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Resolves a trustworthy client IP address from request headers based on deployment ingress.
 *
 * TRUST BOUNDARY & DEPLOYMENT ARCHITECTURE:
 * 1. On Vercel (FindIt's primary target deployment), `x-vercel-forwarded-for` is injected
 *    and controlled by Vercel's edge network. Vercel documents it as equivalent to
 *    `x-forwarded-for` (either a single IP or a comma-separated list).
 * 2. If an external proxy or CDN (e.g., Cloudflare) sits in front of Vercel without enterprise
 *    integration, `x-vercel-forwarded-for` captures the intermediate proxy IP rather than
 *    the end user. In that case, an operator can specify `TRUSTED_IP_HEADER`.
 * 3. In the absence of a guaranteed ingress header (`x-vercel-forwarded-for` or explicitly
 *    configured `TRUSTED_IP_HEADER`), we strictly DO NOT trust spoofable headers such as
 *    unverified `cf-connecting-ip`, `x-real-ip`, or raw `x-forwarded-for` sent directly by
 *    arbitrary clients. We return explicit 'unknown'.
 * 4. This in-memory limiter is process-local defense-in-depth on serverless runtimes.
 *    True cluster-wide volumetric abuse mitigation must be enforced at the platform edge
 *    (e.g., Vercel Firewall / WAF rate limiting).
 */
export function getTrustworthyClientIp(req: Request | { headers: Headers | { get(name: string): string | null } }): string {
  const getHeader = (name: string): string | null => {
    if ('headers' in req && req.headers) {
      if (typeof (req.headers as any).get === 'function') {
        return (req.headers as any).get(name);
      }
      return (req.headers as any)[name] || null;
    }
    return null;
  };

  const extractIp = (value: string | null): string | null => {
    if (!value) return null;
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    // Examine the last valid IP (closest to proxy boundary)
    const candidate = parts[parts.length - 1];
    return isValidIpFormat(candidate) ? candidate : null;
  };

  // 1. Explicitly configured trusted ingress header (if operator configures custom reverse proxy)
  const configuredHeader = process.env.TRUSTED_IP_HEADER;
  if (configuredHeader) {
    const rawConfigured = getHeader(configuredHeader);
    const resolved = extractIp(rawConfigured);
    if (resolved) {
      return resolved;
    }
  }

  // 2. Vercel edge-controlled header (overwritten by Vercel edge ingress)
  const vercelForwarded = getHeader('x-vercel-forwarded-for');
  const resolvedVercel = extractIp(vercelForwarded);
  if (resolvedVercel) {
    return resolvedVercel;
  }

  // Fallback: No guaranteed edge header present. Do not trust spoofable client headers.
  return 'unknown';
}

function isValidIpFormat(ip: string): boolean {
  // Basic IPv4 and IPv6 format sanity check
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

export const rateLimiter = new RateLimiter();
