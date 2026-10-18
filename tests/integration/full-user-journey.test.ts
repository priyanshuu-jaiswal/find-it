import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/src/db';
import { POST as createReportRoute, GET as listReportsRoute } from '@/app/api/v1/reports/route';
import { GET as getMatchesRoute } from '@/app/api/v1/reports/[id]/matches/route';
import { POST as submitClaimRoute } from '@/app/api/v1/reports/[id]/claims/route';
import { GET as listClaimsRoute } from '@/app/api/v1/claims/route';
import { POST as decideClaimRoute } from '@/app/api/v1/claims/[id]/decision/route';
import { GET as getMessagesRoute, POST as postMessageRoute } from '@/app/api/v1/claims/[id]/messages/route';
import { POST as confirmHandoffRoute } from '@/app/api/v1/claims/[id]/confirm-handoff/route';
import { POST as workerTickRoute } from '@/app/api/v1/internal/worker/tick/route';
import { env } from '@/src/lib/env';

describe('End-to-End Complete User Journey', () => {
  let orgId: string;
  let lostReportId: string;
  let foundReportId: string;
  let claimId: string;

  beforeAll(async () => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'apex-university' },
    });
    orgId = org.id;

    // Isolate this test run by creating a separate organization to avoid interference
    const journeyOrg = await prisma.organization.upsert({
      where: { slug: 'journey-campus' },
      update: {},
      create: {
        name: 'Journey Campus',
        slug: 'journey-campus',
      },
    });
    orgId = journeyOrg.id;

    const alice = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@apex.edu' } });
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@apex.edu' } });

    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: orgId, userId: alice.id } },
      update: {},
      create: { organizationId: orgId, userId: alice.id, role: 'MEMBER' },
    });

    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: orgId, userId: bob.id } },
      update: {},
      create: { organizationId: orgId, userId: bob.id, role: 'MEMBER' },
    });
  });

  it('successfully executes: Post Lost -> Post Found -> Match -> Claim -> Approve -> Message -> Confirm Handoff', async () => {
    // -------------------------------------------------------------
    // Step 1: Alice posts a LOST report
    // -------------------------------------------------------------
    const postLostReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'LOST',
        category: 'Electronics',
        title: 'Lost Bose QuietComfort Ultra Earbuds in Black',
        description: 'Black charging case with a small scratch on the front hinge, left in student lounge.',
        color: 'Black',
        brand: 'Bose',
        locationLabel: 'Student Lounge East',
        locationArea: 'Student Center',
        occurredAt: new Date('2026-10-18T08:00:00Z').toISOString(),
      }),
    });
    const postLostRes = await createReportRoute(postLostReq);
    const postLostJson = await postLostRes.json();
    expect(postLostRes.status).toBe(201);
    lostReportId = postLostJson.data.id;

    // -------------------------------------------------------------
    // Step 2: Bob posts a matching FOUND report
    // -------------------------------------------------------------
    const postFoundReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'FOUND',
        category: 'Electronics',
        title: 'Found Bose Black Earbuds in case',
        description: 'Found black wireless earbuds in a charging case in the east student lounge.',
        color: 'Black',
        brand: 'Bose',
        locationLabel: 'Student Lounge East',
        locationArea: 'Student Center',
        occurredAt: new Date('2026-10-18T09:15:00Z').toISOString(),
      }),
    });
    const postFoundRes = await createReportRoute(postFoundReq);
    const postFoundJson = await postFoundRes.json();
    expect(postFoundRes.status).toBe(201);
    foundReportId = postFoundJson.data.id;

    // -------------------------------------------------------------
    // Step 3: Background worker processes candidate matching
    // -------------------------------------------------------------
    const tickReq = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
    });
    const tickRes = await workerTickRoute(tickReq);
    expect(tickRes.status).toBe(200);

    // -------------------------------------------------------------
    // Step 4: Alice views matches and identifies Bob's found item
    // -------------------------------------------------------------
    const getMatchesReq = new NextRequest(`http://localhost:3000/api/v1/reports/${lostReportId}/matches`, {
      headers: { 'x-test-email': 'alice@apex.edu' },
    });
    const getMatchesRes = await getMatchesRoute(getMatchesReq, { params: Promise.resolve({ id: lostReportId }) });
    const getMatchesJson = await getMatchesRes.json();

    expect(getMatchesRes.status).toBe(200);
    expect(getMatchesJson.data.length).toBeGreaterThanOrEqual(1);

    const match = getMatchesJson.data[0];
    expect(match.candidateReport.id).toBe(foundReportId);
    expect(match.score).toBeGreaterThan(0.70);
    expect(match.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Category: Electronics'),
        expect.stringContaining('Matching Brand: Bose'),
        expect.stringContaining('Matching Color: Black'),
        expect.stringContaining('Same Location: Student Lounge East'),
      ])
    );

    // -------------------------------------------------------------
    // Step 5: Alice submits private ownership claim on Bob's found report
    // -------------------------------------------------------------
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/reports/${foundReportId}/claims`, {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({
        proofText: 'The left earbud has a small blue silicone tip replacement instead of black, and Bluetooth name is AliceQC.',
      }),
    });
    const claimRes = await submitClaimRoute(claimReq, { params: Promise.resolve({ id: foundReportId }) });
    const claimJson = await claimRes.json();

    expect(claimRes.status).toBe(201);
    expect(claimJson.data.status).toBe('PENDING');
    claimId = claimJson.data.id;

    // -------------------------------------------------------------
    // Step 6: Bob views incoming claim and verifies private proof
    // -------------------------------------------------------------
    const inboxReq = new NextRequest(`http://localhost:3000/api/v1/claims?orgId=${orgId}&box=incoming`, {
      headers: { 'x-test-email': 'bob@apex.edu' },
    });
    const inboxRes = await listClaimsRoute(inboxReq);
    const inboxJson = await inboxRes.json();

    expect(inboxRes.status).toBe(200);
    const pendingClaim = inboxJson.data.find((c: { id: string }) => c.id === claimId);
    expect(pendingClaim).toBeDefined();
    expect(pendingClaim.proofText).toContain('AliceQC'); // Bob can verify private proof

    // -------------------------------------------------------------
    // Step 7: Bob approves Alice's claim
    // -------------------------------------------------------------
    const approveReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claimId}/decision`, {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        decision: 'APPROVED',
        decisionNote: 'Bluetooth name and blue tip match the device exactly.',
      }),
    });
    const approveRes = await decideClaimRoute(approveReq, { params: Promise.resolve({ id: claimId }) });
    const approveJson = await approveRes.json();

    expect(approveRes.status).toBe(200);
    expect(approveJson.data.status).toBe('APPROVED');

    // -------------------------------------------------------------
    // Step 8: Bob and Alice coordinate physical handoff in chat
    // -------------------------------------------------------------
    const bobMsgReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claimId}/messages`, {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        body: 'Hi Alice! Proof checks out. Can we meet at the campus library entrance around 2 PM?',
      }),
    });
    const bobMsgRes = await postMessageRoute(bobMsgReq, { params: Promise.resolve({ id: claimId }) });
    expect(bobMsgRes.status).toBe(201);

    const aliceMsgReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claimId}/messages`, {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({
        body: 'Sounds great! I will be by the revolving doors wearing a red coat. Thank you so much!',
      }),
    });
    const aliceMsgRes = await postMessageRoute(aliceMsgReq, { params: Promise.resolve({ id: claimId }) });
    expect(aliceMsgRes.status).toBe(201);

    // Read chat history
    const threadReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claimId}/messages`, {
      headers: { 'x-test-email': 'alice@apex.edu' },
    });
    const threadRes = await getMessagesRoute(threadReq, { params: Promise.resolve({ id: claimId }) });
    const threadJson = await threadRes.json();
    expect(threadJson.data).toHaveLength(2);

    // -------------------------------------------------------------
    // Step 9: Handoff is completed and confirmed
    // -------------------------------------------------------------
    const confirmReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claimId}/confirm-handoff`, {
      method: 'POST',
      headers: { 'x-test-email': 'alice@apex.edu' },
      body: JSON.stringify({
        note: 'Met Bob at library entrance, earbuds paired and verified.',
      }),
    });
    const confirmRes = await confirmHandoffRoute(confirmReq, { params: Promise.resolve({ id: claimId }) });
    const confirmJson = await confirmRes.json();

    expect(confirmRes.status).toBe(200);
    expect(confirmJson.data.status).toBe('HANDOFF_CONFIRMED');

    // -------------------------------------------------------------
    // Step 10: Verify atomic resolution of parent report
    // -------------------------------------------------------------
    const finalReport = await prisma.report.findUniqueOrThrow({
      where: { id: foundReportId },
    });
    expect(finalReport.status).toBe('RESOLVED');
    expect(finalReport.resolvedAt).not.toBeNull();
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
      await prisma.claimMessage.deleteMany({
        where: { claim: { report: { organizationId: orgId } } },
      });
      await prisma.claim.deleteMany({
        where: { report: { organizationId: orgId } },
      });
      await prisma.reportMatch.deleteMany({ where: { organizationId: orgId } });
      await prisma.reportImage.deleteMany({ where: { organizationId: orgId } });
      await prisma.report.deleteMany({ where: { organizationId: orgId } });
      await prisma.membership.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });
});
