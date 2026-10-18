import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/src/db';
import { POST as createReportRoute } from '@/app/api/v1/reports/route';
import { POST as flagReportRoute } from '@/app/api/v1/reports/[id]/flag/route';
import { GET as getModerationQueueRoute } from '@/app/api/v1/moderation/reports/route';
import { POST as takeActionRoute } from '@/app/api/v1/moderation/reports/[id]/action/route';
import { rateLimiter } from '@/src/lib/rate-limit';

describe('Phase 4: Moderation, Audit & Release Hardening Integration', () => {
  let orgId: string;
  let otherOrgId: string;
  let reportId: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  beforeAll(async () => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'apex-university' },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'other-university' },
    });
    otherOrgId = otherOrg.id;

    const alice = await prisma.user.findUniqueOrThrow({
      where: { email: 'alice@apex.edu' },
    });
    aliceId = alice.id;

    const bob = await prisma.user.findUniqueOrThrow({
      where: { email: 'bob@apex.edu' },
    });
    bobId = bob.id;

    const carol = await prisma.user.findUniqueOrThrow({
      where: { email: 'carol@apex.edu' },
    });
    carolId = carol.id;

    // Reset rate limiter
    rateLimiter.clear();

    // Create a suspicious report posted by Bob to test moderation
    const reportReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'LOST',
        category: 'Electronics',
        title: 'Suspicious Device with wire harness',
        description: 'Left a strange unmarked electronic device near the electrical sub-station.',
        locationLabel: 'Sub-station Lot 4',
      }),
    });
    const reportRes = await createReportRoute(reportReq);
    const reportJson = await reportRes.json();
    expect(reportRes.status).toBe(201);
    reportId = reportJson.data.id;
  });

  describe('Report Flagging & Domain Guards', () => {
    it('rejects flags with short reason (< 5 chars) with 400 VALIDATION_ERROR', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/flag`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          reason: 'bad',
        }),
      });

      const res = await flagReportRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('allows a member (Alice) to flag a suspicious report', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/flag`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          reason: 'This report describes suspicious equipment in a restricted campus utility zone.',
        }),
      });

      const res = await flagReportRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.status).toBe('OPEN');
    });

    it('rejects duplicate flags by the same reporter with 409 CONFLICT', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/flag`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          reason: 'Submitting duplicate flag on the same report.',
        }),
      });

      const res = await flagReportRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.error.code).toBe('CONFLICT');
    });

    it('enforces rate limiting when user exceeds flagging threshold', async () => {
      // Artificially trigger rate limit for Alice on flag endpoint
      rateLimiter.reset(`flag:${aliceId}`);
      for (let i = 0; i < 10; i++) {
        rateLimiter.check(`flag:${aliceId}`, 10, 60_000);
      }

      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/flag`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          reason: 'Excessive flag attempt',
        }),
      });

      const res = await flagReportRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(429);
      expect(json.error.code).toBe('RATE_LIMITED');

      rateLimiter.clear();
    });
  });

  describe('Moderator Queue & Role Authorization', () => {
    it('blocks regular member (Alice) from accessing moderator queue with 403 FORBIDDEN', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/moderation/reports?orgId=${orgId}&status=OPEN`, {
        headers: { 'x-test-email': 'alice@apex.edu' },
      });

      const res = await getModerationQueueRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 NOT_FOUND when accessing moderation for an organization the user does not belong to', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/moderation/reports?orgId=${otherOrgId}&status=OPEN`, {
        headers: { 'x-test-email': 'carol@apex.edu' },
      });

      const res = await getModerationQueueRoute(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('allows organization moderator (Carol) to view open flagged reports in the queue', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/moderation/reports?orgId=${orgId}&status=OPEN`, {
        headers: { 'x-test-email': 'carol@apex.edu' },
      });

      const res = await getModerationQueueRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBeGreaterThanOrEqual(1);

      const queueItem = json.data.find((item: { report: { id: string } }) => item.report.id === reportId);
      expect(queueItem).toBeDefined();
      expect(queueItem.flagCount).toBeGreaterThanOrEqual(1);
      expect(queueItem.flags[0].reason).toContain('restricted campus utility zone');
      expect(queueItem.flags[0].reporterName).toBe('Alice Chen');
    });
  });

  describe('Moderator Enforcement Actions & Immutable Audit Log', () => {
    it('blocks regular member (Alice) from taking moderator actions with 403 FORBIDDEN', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/moderation/reports/${reportId}/action`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          action: 'HIDE',
          note: 'Unauthorized hide attempt',
        }),
      });

      const res = await takeActionRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('allows moderator (Carol) to HIDE report and writes immutable audit_events entry', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/moderation/reports/${reportId}/action`, {
        method: 'POST',
        headers: { 'x-test-email': 'carol@apex.edu' },
        body: JSON.stringify({
          action: 'HIDE',
          note: 'Hidden pending security verification with facilities management',
        }),
      });

      const res = await takeActionRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.status).toBe('HIDDEN');

      // Verify report is HIDDEN in database
      const dbReport = await prisma.report.findUniqueOrThrow({
        where: { id: reportId },
      });
      expect(dbReport.status).toBe('HIDDEN');

      // Verify open flags on this report transitioned to ACTIONED
      const flags = await prisma.moderationReport.findMany({
        where: { reportId },
      });
      expect(flags.every((f) => f.status === 'ACTIONED')).toBe(true);
      expect(flags[0].reviewedBy).toBe(carolId);

      // Verify immutable audit event was recorded
      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          entityType: 'REPORT',
          entityId: reportId,
          action: 'HIDE',
        },
      });
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.actorId).toBe(carolId);
      expect(auditEvent?.organizationId).toBe(orgId);
    });

    it('allows moderator (Carol) to RESTORE report and writes audit event', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/moderation/reports/${reportId}/action`, {
        method: 'POST',
        headers: { 'x-test-email': 'carol@apex.edu' },
        body: JSON.stringify({
          action: 'RESTORE',
          note: 'Verified with engineering lab tech. Legitimate senior design project.',
        }),
      });

      const res = await takeActionRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.status).toBe('OPEN');

      const dbReport = await prisma.report.findUniqueOrThrow({
        where: { id: reportId },
      });
      expect(dbReport.status).toBe('OPEN');

      // Verify audit event for RESTORE
      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          entityType: 'REPORT',
          entityId: reportId,
          action: 'RESTORE',
        },
      });
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.actorId).toBe(carolId);
    });
  });
});
