import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/src/db';
import { POST as createReportRoute } from '@/app/api/v1/reports/route';
import { GET as getMatchesRoute } from '@/app/api/v1/reports/[id]/matches/route';
import { POST as feedbackRoute } from '@/app/api/v1/matches/[id]/feedback/route';
import { POST as workerTickRoute } from '@/app/api/v1/internal/worker/tick/route';
import { env } from '@/src/lib/env';

describe('Phase 2: Deterministic Matching Engine Integration', () => {
  let orgId: string;
  let otherOrgId: string;
  let lostReportId: string;
  let foundReportId: string;
  let selfFoundReportId: string;
  let unrelatedReportId: string;
  let matchId: string;

  beforeAll(async () => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'apex-university' },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'other-university' },
    });
    otherOrgId = otherOrg.id;

    // Clean up test reports from previous runs to ensure pristine deterministic state
    await prisma.matchFeedback.deleteMany();
    await prisma.reportMatch.deleteMany();
    await prisma.report.deleteMany({
      where: { organizationId: orgId },
    });
  });

  it('posts LOST and FOUND items and computes deterministic candidate matches via worker', async () => {
    // 1. Alice posts a LOST report
    const lostReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'LOST',
        category: 'Electronics',
        title: 'Lost Apple iPad Pro 11-inch with Apple Pencil',
        description: 'Space gray iPad Pro in black folio case left on study table 4 in the main library.',
        color: 'Gray',
        brand: 'Apple',
        locationLabel: 'Main Library 3rd Floor',
        locationArea: 'West Campus',
        occurredAt: new Date('2026-10-17T10:00:00Z').toISOString(),
      }),
    });
    const lostRes = await createReportRoute(lostReq);
    const lostJson = await lostRes.json();
    expect(lostRes.status).toBe(201);
    lostReportId = lostJson.data.id;

    // 2. Bob posts a plausible matching FOUND report
    const foundReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'FOUND',
        category: 'Electronics',
        title: 'Found Apple iPad tablet with stylus',
        description: 'Found an Apple iPad in black case on a study desk on the 3rd floor of the library.',
        color: 'Gray',
        brand: 'Apple',
        locationLabel: 'Main Library 3rd Floor',
        locationArea: 'West Campus',
        occurredAt: new Date('2026-10-17T11:30:00Z').toISOString(),
      }),
    });
    const foundRes = await createReportRoute(foundReq);
    const foundJson = await foundRes.json();
    expect(foundRes.status).toBe(201);
    foundReportId = foundJson.data.id;

    // 3. Alice posts a FOUND report to verify self-matches are prevented
    const selfFoundReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'FOUND',
        category: 'Electronics',
        title: 'Found iPad in library',
        description: 'Found another iPad device.',
        locationLabel: 'Main Library 3rd Floor',
      }),
    });
    const selfFoundRes = await createReportRoute(selfFoundReq);
    const selfFoundJson = await selfFoundRes.json();
    expect(selfFoundRes.status).toBe(201);
    selfFoundReportId = selfFoundJson.data.id;

    // 4. Bob posts an unrelated FOUND report (Clothing)
    const unrelatedReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'FOUND',
        category: 'Clothing',
        title: 'Found Brown Leather Jacket',
        description: 'Heavy brown winter leather jacket found on the bleachers in the sports gym.',
        color: 'Brown',
        locationLabel: 'Sports Gymnasium Bleachers',
      }),
    });
    const unrelatedRes = await createReportRoute(unrelatedReq);
    const unrelatedJson = await unrelatedRes.json();
    expect(unrelatedRes.status).toBe(201);
    unrelatedReportId = unrelatedJson.data.id;

    // 5. Trigger Worker Tick to process COMPUTE_MATCHES jobs
    const tickReq = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
    });
    const tickRes = await workerTickRoute(tickReq);
    expect(tickRes.status).toBe(200);

    // 6. Alice queries candidate matches for her LOST report
    const matchesReq = new NextRequest(`http://localhost:3000/api/v1/reports/${lostReportId}/matches`, {
      headers: { 'x-test-email': 'alice@apex.edu' },
    });
    const matchesRes = await getMatchesRoute(matchesReq, { params: Promise.resolve({ id: lostReportId }) });
    const matchesJson = await matchesRes.json();

    expect(matchesRes.status).toBe(200);
    expect(matchesJson.data.length).toBe(1); // Exactly Bob's found iPad

    const topMatch = matchesJson.data[0];
    matchId = topMatch.matchId;

    expect(topMatch.candidateReport.id).toBe(foundReportId);
    expect(topMatch.score).toBeGreaterThan(0.70);
    expect(topMatch.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Category: Electronics'),
        expect.stringContaining('Matching Brand: Apple'),
        expect.stringContaining('Same Location: Main Library 3rd Floor'),
        expect.stringContaining('Occurred within 24 hours'),
      ])
    );

    // Verify Alice's own found report never appeared (No self-matching)
    const selfMatch = matchesJson.data.find((m: { candidateReport: { id: string } }) => m.candidateReport.id === selfFoundReportId);
    expect(selfMatch).toBeUndefined();

    // Verify Bob's unrelated leather jacket never appeared (Score < 0.35 threshold)
    const unrelatedMatch = matchesJson.data.find((m: { candidateReport: { id: string } }) => m.candidateReport.id === unrelatedReportId);
    expect(unrelatedMatch).toBeUndefined();
  });

  it('allows the opposite report owner (Bob) to see the matching candidate', async () => {
    const matchesReq = new NextRequest(`http://localhost:3000/api/v1/reports/${foundReportId}/matches`, {
      headers: { 'x-test-email': 'bob@apex.edu' },
    });
    const matchesRes = await getMatchesRoute(matchesReq, { params: Promise.resolve({ id: foundReportId }) });
    const matchesJson = await matchesRes.json();

    expect(matchesRes.status).toBe(200);
    expect(matchesJson.data.length).toBe(1);
    expect(matchesJson.data[0].candidateReport.id).toBe(lostReportId);
  });

  it('records useful and dismiss feedback and hides dismissed matches by default', async () => {
    // 1. Submit useful: true feedback
    const usefulReq = new NextRequest(`http://localhost:3000/api/v1/matches/${matchId}/feedback`, {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({ useful: true }),
    });
    const usefulRes = await feedbackRoute(usefulReq, { params: Promise.resolve({ id: matchId }) });
    expect(usefulRes.status).toBe(204);

    // 2. Submit dismissed: true feedback
    const dismissReq = new NextRequest(`http://localhost:3000/api/v1/matches/${matchId}/feedback`, {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({ dismissed: true }),
    });
    const dismissRes = await feedbackRoute(dismissReq, { params: Promise.resolve({ id: matchId }) });
    expect(dismissRes.status).toBe(204);

    // 3. Querying matches with default includeDismissed=false returns 0 items
    const defaultMatchesReq = new NextRequest(`http://localhost:3000/api/v1/reports/${lostReportId}/matches`, {
      headers: { 'x-test-email': 'alice@apex.edu' },
    });
    const defaultMatchesRes = await getMatchesRoute(defaultMatchesReq, { params: Promise.resolve({ id: lostReportId }) });
    const defaultMatchesJson = await defaultMatchesRes.json();

    expect(defaultMatchesRes.status).toBe(200);
    expect(defaultMatchesJson.data.length).toBe(0); // Excluded!

    // 4. Querying matches with includeDismissed=true returns the match with flags
    const includeDismissedReq = new NextRequest(`http://localhost:3000/api/v1/reports/${lostReportId}/matches?includeDismissed=true`, {
      headers: { 'x-test-email': 'alice@apex.edu' },
    });
    const includeDismissedRes = await getMatchesRoute(includeDismissedReq, { params: Promise.resolve({ id: lostReportId }) });
    const includeDismissedJson = await includeDismissedRes.json();

    expect(includeDismissedRes.status).toBe(200);
    expect(includeDismissedJson.data.length).toBe(1);
    expect(includeDismissedJson.data[0].dismissed).toBe(true);
    expect(includeDismissedJson.data[0].useful).toBe(true);
  });

  it('rejects match access for non-owners and cross-org requests', async () => {
    // Non-owner member (Carol is moderator, but let's test a third member or unauthorized user)
    // Non-member in other-university
    const otherReq = new NextRequest(`http://localhost:3000/api/v1/reports/${lostReportId}/matches`, {
      headers: { 'x-test-email': 'other@other.edu' },
    });
    const otherRes = await getMatchesRoute(otherReq, { params: Promise.resolve({ id: lostReportId }) });
    expect(otherRes.status).toBe(401);
  });
});
