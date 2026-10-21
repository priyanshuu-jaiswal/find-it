import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { POST as reportsRoute } from '@/app/api/v1/reports/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import prisma from '@/src/db';
import { rateLimiter } from '@/src/lib/rate-limit';

const TEST_SECRET = 'super-secret-crypto-key-for-test-environments-32-chars';
const MOCK_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MOCK_EMAIL = 'student@cmrit.ac.in';

vi.mock('@/src/db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    membership: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/src/modules/reports/service', () => ({
  reportsService: {
    createReport: vi.fn().mockResolvedValue({ id: 'report-123', title: 'Test Report' }),
    listReports: vi.fn().mockResolvedValue({ data: [], page: { total: 0 } }),
  },
}));

describe('Route-Level Security Integration', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter.clear();
    process.env.AUTH_SECRET = TEST_SECRET;

    (vi.mocked(prisma.user.findUnique) as any).mockImplementation(async ({ where }: any) => {
      if (where?.email === MOCK_EMAIL || where?.id === MOCK_USER_ID) {
        return {
          id: MOCK_USER_ID,
          email: MOCK_EMAIL,
          displayName: 'Test Student',
          passwordHash: null,
          disabledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any;
      }
      return null;
    });

    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'org-cmrit',
      name: 'CMR Institute of Technology',
      slug: 'cmrit-lost-and-found',
      domain: 'cmrit.ac.in',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
  });

  describe('Route-Level Session Token Validation & Fail-Closed Behavior', () => {
    function generateTokenWithTimestamp(email: string, timestamp: number, secret = TEST_SECRET): string {
      const payload = `${email.toLowerCase().trim()}|${timestamp}`;
      const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
      const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');
      return `${encodedPayload}.${signature}`;
    }

    it('fails closed (HTTP 401 UNAUTHENTICATED) at route level when AUTH_SECRET is completely missing', async () => {
      // Create valid token signed with original secret
      const validToken = generateTokenWithTimestamp(MOCK_EMAIL, Date.now());

      // Strip AUTH_SECRET from runtime environment
      delete process.env.AUTH_SECRET;

      const req = new NextRequest('http://localhost:3000/api/v1/reports', {
        method: 'POST',
        headers: {
          cookie: `cmrit-session=${validToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orgId: 'aaaaaaaa-1111-2222-3333-444444444444',
          type: 'LOST',
          title: 'Lost Keys in Cafeteria',
          description: 'Set of two keys with blue tag',
          category: 'KEYS',
          dateLostOrFound: new Date().toISOString(),
          location: 'Main Cafeteria',
        }),
      });

      const res = await reportsRoute(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('fails closed (HTTP 401 UNAUTHENTICATED) at route level when session token is future-dated beyond clock skew', async () => {
      // 10 minutes in the future (> 60s clock skew)
      const futureTimestamp = Date.now() + 10 * 60 * 1000;
      const futureToken = generateTokenWithTimestamp(MOCK_EMAIL, futureTimestamp);

      const req = new NextRequest('http://localhost:3000/api/v1/reports', {
        method: 'POST',
        headers: {
          cookie: `cmrit-session=${futureToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orgId: 'aaaaaaaa-1111-2222-3333-444444444444',
          type: 'LOST',
          title: 'Lost Watch',
          description: 'Silver digital watch',
          category: 'ELECTRONICS',
          dateLostOrFound: new Date().toISOString(),
          location: 'Library',
        }),
      });

      const res = await reportsRoute(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('fails closed (HTTP 401 UNAUTHENTICATED) at route level when session token is expired (> 30 days)', async () => {
      // 35 days in the past
      const expiredTimestamp = Date.now() - 35 * 24 * 60 * 60 * 1000;
      const expiredToken = generateTokenWithTimestamp(MOCK_EMAIL, expiredTimestamp);

      const req = new NextRequest('http://localhost:3000/api/v1/reports', {
        method: 'POST',
        headers: {
          cookie: `cmrit-session=${expiredToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orgId: 'aaaaaaaa-1111-2222-3333-444444444444',
          type: 'LOST',
          title: 'Lost ID card',
          description: 'College student ID',
          category: 'CARDS_AND_IDS',
          dateLostOrFound: new Date().toISOString(),
          location: 'Audi',
        }),
      });

      const res = await reportsRoute(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('fails closed (HTTP 401 UNAUTHENTICATED) at route level when token signature is tampered', async () => {
      const validToken = generateTokenWithTimestamp(MOCK_EMAIL, Date.now());
      const [payload, signature] = validToken.split('.');
      // Tamper signature by changing last character
      const tamperedSignature = signature.slice(0, -1) + (signature.slice(-1) === 'a' ? 'b' : 'a');
      const tamperedToken = `${payload}.${tamperedSignature}`;

      const req = new NextRequest('http://localhost:3000/api/v1/reports', {
        method: 'POST',
        headers: {
          cookie: `cmrit-session=${tamperedToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orgId: 'aaaaaaaa-1111-2222-3333-444444444444',
          type: 'LOST',
          title: 'Lost Bottle',
          description: 'Steel bottle',
          category: 'OTHER',
          dateLostOrFound: new Date().toISOString(),
          location: 'Gym',
        }),
      });

      const res = await reportsRoute(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('authenticates successfully at route level with valid unexpired token and configured secret', async () => {
      const validToken = generateTokenWithTimestamp(MOCK_EMAIL, Date.now());

      const req = new NextRequest('http://localhost:3000/api/v1/reports', {
        method: 'POST',
        headers: {
          cookie: `cmrit-session=${validToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orgId: 'e59174f7-3e54-4a47-a365-a86f9175a2df',
          type: 'LOST',
          title: 'Lost Umbrella',
          description: 'Black folding umbrella with curved handle',
          category: 'OTHER',
          locationLabel: 'Block 2 Cafeteria',
        }),
      });

      const res = await reportsRoute(req);
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe('report-123');
    });
  });

  describe('Route-Level Ingress IP Trust & Rate Limiting Policy', () => {
    it('uses edge-guaranteed x-vercel-forwarded-for header for login rate limiting', async () => {
      const clientIp = '198.51.100.77';

      // Submit 10 rapid invalid login requests from this IP
      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'x-vercel-forwarded-for': clientIp,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `user${i}@cmrit.ac.in`,
            password: 'wrongpassword',
            mode: 'signin',
          }),
        });

        await loginRoute(req);
      }

      // The 11th request from this IP must be blocked by rate limiter (HTTP 429)
      const blockedReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'x-vercel-forwarded-for': clientIp,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'another@cmrit.ac.in',
          password: 'wrongpassword',
          mode: 'signin',
        }),
      });

      const res = await loginRoute(blockedReq);
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.error?.code).toBe('RATE_LIMITED');
      expect(body.error?.message).toMatch(/Rate limit exceeded/);
    });

    it('rejects untrusted headers (x-forwarded-for, cf-connecting-ip) and buckets under "unknown"', async () => {
      // Attacker attempts to spoof their IP by sending client-supplied proxy headers
      const spoofedHeaders = {
        'cf-connecting-ip': '203.0.113.111',
        'x-real-ip': '203.0.113.222',
        'x-forwarded-for': '203.0.113.333',
        'content-type': 'application/json',
      };

      // 10 requests with spoofed headers will all be mapped to 'unknown' IP
      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: spoofedHeaders,
          body: JSON.stringify({
            email: `student${i}@cmrit.ac.in`,
            password: 'badpassword',
            mode: 'signin',
          }),
        });

        await loginRoute(req);
      }

      // Next request with different spoofed IP header still hits 'unknown' bucket and gets rate limited
      const reqBlocked = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.999', // Different spoofed IP
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'student_target@cmrit.ac.in',
          password: 'badpassword',
          mode: 'signin',
        }),
      });

      const res = await loginRoute(reqBlocked);
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.error?.code).toBe('RATE_LIMITED');
    });
  });
});
