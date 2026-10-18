import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/src/db';
import { POST as createReportRoute } from '@/app/api/v1/reports/route';
import { POST as submitClaimRoute } from '@/app/api/v1/reports/[id]/claims/route';
import { GET as listClaimsRoute } from '@/app/api/v1/claims/route';
import { POST as decideClaimRoute } from '@/app/api/v1/claims/[id]/decision/route';
import { GET as getMessagesRoute, POST as postMessageRoute } from '@/app/api/v1/claims/[id]/messages/route';
import { POST as confirmHandoffRoute } from '@/app/api/v1/claims/[id]/confirm-handoff/route';

describe('Phase 3: Claims, Concurrency & Handoff Integration', () => {
  let orgId: string;
  let otherOrgId: string;
  let reportId: string;
  let claim1Id: string; // Alice's claim
  let claim2Id: string; // Carol's claim (seeded moderator acting as claimant for test)
  let aliceId: string;
  let bobId: string;

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

    // Bob creates a FOUND report: "Found Silver MacBook Air M2 in Library"
    const reportReq = new NextRequest('http://localhost:3000/api/v1/reports', {
      method: 'POST',
      headers: { 'x-test-email': 'bob@apex.edu' },
      body: JSON.stringify({
        orgId,
        type: 'FOUND',
        category: 'Electronics',
        title: 'Found Silver MacBook Air M2 in Library Study Room B',
        description: 'Found a silver laptop with stickers on the lid left behind on the table.',
        color: 'Silver',
        brand: 'Apple',
        locationLabel: 'Library Study Room B',
      }),
    });
    const reportRes = await createReportRoute(reportReq);
    const reportJson = await reportRes.json();
    expect(reportRes.status).toBe(201);
    reportId = reportJson.data.id;
  });

  describe('Claim Submission & Domain Guards', () => {
    it('rejects self-claims with 422 INVALID_STATE', async () => {
      // Bob is the owner of reportId; Bob attempting to claim his own report must fail
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/claims`, {
        method: 'POST',
        headers: { 'x-test-email': 'bob@apex.edu' },
        body: JSON.stringify({
          proofText: 'This is actually my own laptop that I found myself.',
        }),
      });

      const res = await submitClaimRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe('INVALID_STATE');
      expect(json.error.message).toContain('Report owners cannot submit claims on their own reports');
    });

    it('rejects claims with invalid proofText length with 400 VALIDATION_ERROR', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/claims`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          proofText: 'Too short', // < 10 chars
        }),
      });

      const res = await submitClaimRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('allows non-owner member (Alice) to submit private ownership claim', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/claims`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          proofText: 'Has a NASA sticker on the top right corner and a scratched bottom left rubber foot. Serial ends in 8849.',
        }),
      });

      const res = await submitClaimRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.status).toBe('PENDING');
      expect(json.data.claimantId).toBe(aliceId);
      claim1Id = json.data.id;
    });

    it('rejects duplicate claims by the same claimant on the same report with 409 CONFLICT', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/claims`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          proofText: 'Submitting a second duplicate claim for the same laptop.',
        }),
      });

      const res = await submitClaimRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.error.code).toBe('CONFLICT');
    });

    it('allows a second claimant (Carol) to submit a competing claim', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${reportId}/claims`, {
        method: 'POST',
        headers: { 'x-test-email': 'carol@apex.edu' },
        body: JSON.stringify({
          proofText: 'Belongs to our safety office student volunteer. Silver M2 13-inch.',
        }),
      });

      const res = await submitClaimRoute(req, { params: Promise.resolve({ id: reportId }) });
      const json = await res.json();

      expect(res.status).toBe(201);
      claim2Id = json.data.id;
    });
  });

  describe('Claims Inbox & Privacy Protection', () => {
    it('retrieves incoming claims for report owner (Bob) showing full private proofText', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/claims?orgId=${orgId}&box=incoming`, {
        headers: { 'x-test-email': 'bob@apex.edu' },
      });

      const res = await listClaimsRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBeGreaterThanOrEqual(2);

      const aliceClaim = json.data.find((c: { id: string }) => c.id === claim1Id);
      expect(aliceClaim).toBeDefined();
      expect(aliceClaim.proofText).toContain('NASA sticker'); // Owner can see private proof!
    });

    it('retrieves outgoing claims for claimant (Alice) showing their own proofText', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/claims?orgId=${orgId}&box=outgoing`, {
        headers: { 'x-test-email': 'alice@apex.edu' },
      });

      const res = await listClaimsRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      const myClaim = json.data.find((c: { id: string }) => c.id === claim1Id);
      expect(myClaim).toBeDefined();
      expect(myClaim.proofText).toContain('NASA sticker');
    });
  });

  describe('Gated Messaging Before Approval', () => {
    it('blocks messaging on PENDING claims with 422 INVALID_STATE', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/claims/${claim1Id}/messages`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          body: 'Hello Bob, where can we meet?',
        }),
      });

      const res = await postMessageRoute(req, { params: Promise.resolve({ id: claim1Id }) });
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe('INVALID_STATE');
      expect(json.error.message).toContain('only available when the claim is in APPROVED status');
    });
  });

  describe('Concurrency & Single Active Approval Lock', () => {
    it('enforces single active approval lock under concurrent approval attempts', async () => {
      // Fire concurrent APPROVED decisions for claim1 (Alice) and claim2 (Carol) on the same report
      const approveAliceReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claim1Id}/decision`, {
        method: 'POST',
        headers: { 'x-test-email': 'bob@apex.edu' },
        body: JSON.stringify({
          decision: 'APPROVED',
          decisionNote: 'Proof matches description of sticker',
        }),
      });

      const approveCarolReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claim2Id}/decision`, {
        method: 'POST',
        headers: { 'x-test-email': 'bob@apex.edu' },
        body: JSON.stringify({
          decision: 'APPROVED',
          decisionNote: 'Competing approval attempt',
        }),
      });

      // Execute both concurrently
      const [res1, res2] = await Promise.all([
        decideClaimRoute(approveAliceReq, { params: Promise.resolve({ id: claim1Id }) }),
        decideClaimRoute(approveCarolReq, { params: Promise.resolve({ id: claim2Id }) }),
      ]);

      const statuses = [res1.status, res2.status].sort();

      // Exactly one must succeed (200) and one must be rejected by lock/constraint (409)
      expect(statuses).toEqual([200, 409]);

      // Check database state: exactly one claim is APPROVED
      const approvedClaims = await prisma.claim.findMany({
        where: {
          reportId,
          status: 'APPROVED',
        },
      });
      expect(approvedClaims).toHaveLength(1);
    });
  });

  describe('Gated Messaging After Approval', () => {
    it('allows owner and claimant to exchange messages once approved', async () => {
      // 1. Bob (owner) posts a message to coordinate handoff
      const msg1Req = new NextRequest(`http://localhost:3000/api/v1/claims/${claim1Id}/messages`, {
        method: 'POST',
        headers: { 'x-test-email': 'bob@apex.edu' },
        body: JSON.stringify({
          body: 'Hi Alice, I have your laptop. Can we meet at the campus safety office at 3 PM?',
        }),
      });
      const msg1Res = await postMessageRoute(msg1Req, { params: Promise.resolve({ id: claim1Id }) });
      const msg1Json = await msg1Res.json();

      expect(msg1Res.status).toBe(201);
      expect(msg1Json.data.body).toContain('safety office');
      expect(msg1Json.data.senderName).toBe('Bob Smith');

      // 2. Alice (claimant) replies
      const msg2Req = new NextRequest(`http://localhost:3000/api/v1/claims/${claim1Id}/messages`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          body: 'Perfect! I will bring my student ID. See you then.',
        }),
      });
      const msg2Res = await postMessageRoute(msg2Req, { params: Promise.resolve({ id: claim1Id }) });
      expect(msg2Res.status).toBe(201);

      // 3. Retrieve thread
      const listMsgReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claim1Id}/messages`, {
        headers: { 'x-test-email': 'alice@apex.edu' },
      });
      const listMsgRes = await getMessagesRoute(listMsgReq, { params: Promise.resolve({ id: claim1Id }) });
      const listMsgJson = await listMsgRes.json();

      expect(listMsgRes.status).toBe(200);
      expect(listMsgJson.data).toHaveLength(2);
      expect(listMsgJson.data[0].body).toContain('safety office');
      expect(listMsgJson.data[1].body).toContain('student ID');
    });
  });

  describe('Atomic Handoff Confirmation', () => {
    it('confirms physical handoff, marks claim HANDOFF_CONFIRMED, resolves parent report, and auto-rejects pending claims', async () => {
      // Alice confirms physical exchange
      const confirmReq = new NextRequest(`http://localhost:3000/api/v1/claims/${claim1Id}/confirm-handoff`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          note: 'Met at safety desk, device unlocked successfully with my PIN',
        }),
      });

      const confirmRes = await confirmHandoffRoute(confirmReq, { params: Promise.resolve({ id: claim1Id }) });
      const confirmJson = await confirmRes.json();

      expect(confirmRes.status).toBe(200);
      expect(confirmJson.data.status).toBe('HANDOFF_CONFIRMED');

      // 1. Verify parent report is atomically marked RESOLVED
      const resolvedReport = await prisma.report.findUniqueOrThrow({
        where: { id: reportId },
      });
      expect(resolvedReport.status).toBe('RESOLVED');
      expect(resolvedReport.resolvedAt).not.toBeNull();

      // 2. Verify competing claim (Carol's claim2) is auto-rejected
      const competingClaim = await prisma.claim.findUniqueOrThrow({
        where: { id: claim2Id },
      });
      expect(competingClaim.status).toBe('REJECTED');
      expect(competingClaim.decisionNote).toContain('Auto-rejected');
    });
  });
});
