import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/me/route';

describe('GET /api/v1/me', () => {
  it('returns 401 UNAUTHENTICATED when no session or auth header is present', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/me');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns authenticated user and organization role for seeded Member A (Alice)', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/me', {
      headers: {
        'x-test-email': 'alice@apex.edu',
      },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.user.email).toBe('alice@apex.edu');
    expect(body.data.user.displayName).toBe('Alice Chen');
    expect(body.data.memberships).toHaveLength(1);
    expect(body.data.memberships[0]).toMatchObject({
      slug: 'apex-university',
      name: 'Apex University',
      role: 'MEMBER',
    });
  });

  it('returns authenticated user and MODERATOR role for seeded Carol', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/me', {
      headers: {
        'x-test-email': 'carol@apex.edu',
      },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.user.email).toBe('carol@apex.edu');
    expect(body.data.memberships[0]).toMatchObject({
      slug: 'apex-university',
      role: 'MODERATOR',
    });
  });
});
