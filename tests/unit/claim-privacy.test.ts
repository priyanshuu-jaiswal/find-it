import { describe, it, expect } from 'vitest';
import { ClaimStatus, ReportStatus, ReportType } from '@prisma/client';

/**
 * Pure policy unit tests for Claimant Email and Proof Text disclosure.
 * Rule:
 * 1. ProofText is visible ONLY to the claimant and the report owner.
 * 2. Claimant email is visible ONLY to:
 *    - The claimant themselves
 *    - The report owner AFTER approval (APPROVED or HANDOFF_CONFIRMED)
 * 3. Moderators, admins, and unapproved owners NEVER receive the claimant email.
 */
function sanitizeClaimForViewer(
  claim: {
    id: string;
    claimantId: string;
    proofText: string;
    status: ClaimStatus;
    report: {
      id: string;
      ownerId: string;
    };
    claimant: {
      id: string;
      displayName: string;
      email: string;
    };
  },
  viewerId: string
) {
  const isOwner = claim.report.ownerId === viewerId;
  const isClaimant = claim.claimantId === viewerId;
  const isHandoffReady =
    claim.status === ClaimStatus.APPROVED || claim.status === ClaimStatus.HANDOFF_CONFIRMED;

  const canSeeProof = isOwner || isClaimant;
  const canSeeContact = isClaimant || (isOwner && isHandoffReady);

  return {
    id: claim.id,
    status: claim.status,
    proofText: canSeeProof ? claim.proofText : '[PROTECTED]',
    claimant: {
      id: claim.claimant.id,
      displayName: claim.claimant.displayName,
      email: canSeeContact ? claim.claimant.email : undefined,
    },
  };
}

describe('Claim Privacy & Contact Disclosure Policy', () => {
  const ownerId = 'user-owner-1';
  const claimantId = 'user-claimant-2';
  const moderatorId = 'user-moderator-3';
  const unrelatedId = 'user-unrelated-4';

  const baseClaim = {
    id: 'claim-123',
    claimantId,
    proofText: 'Confidential serial number: CMRIT-9921',
    status: ClaimStatus.PENDING,
    report: {
      id: 'report-456',
      ownerId,
    },
    claimant: {
      id: claimantId,
      displayName: 'Priya Sharma',
      email: 'priya@cmrit.ac.in',
    },
  };

  describe('Pending Claims', () => {
    const pendingClaim = { ...baseClaim, status: ClaimStatus.PENDING };

    it('masks claimant email from report owner while keeping proof visible for evaluation', () => {
      const sanitized = sanitizeClaimForViewer(pendingClaim, ownerId);
      expect(sanitized.proofText).toBe('Confidential serial number: CMRIT-9921');
      expect(sanitized.claimant.email).toBeUndefined(); // Email masked!
    });

    it('allows claimant to see their own email and proof', () => {
      const sanitized = sanitizeClaimForViewer(pendingClaim, claimantId);
      expect(sanitized.proofText).toBe('Confidential serial number: CMRIT-9921');
      expect(sanitized.claimant.email).toBe('priya@cmrit.ac.in');
    });

    it('masks both proof and email from moderators and third parties', () => {
      const modView = sanitizeClaimForViewer(pendingClaim, moderatorId);
      expect(modView.proofText).toBe('[PROTECTED]');
      expect(modView.claimant.email).toBeUndefined();

      const memberView = sanitizeClaimForViewer(pendingClaim, unrelatedId);
      expect(memberView.proofText).toBe('[PROTECTED]');
      expect(memberView.claimant.email).toBeUndefined();
    });
  });

  describe('Rejected Claims', () => {
    const rejectedClaim = { ...baseClaim, status: ClaimStatus.REJECTED };

    it('masks claimant email from report owner on rejected claim', () => {
      const sanitized = sanitizeClaimForViewer(rejectedClaim, ownerId);
      expect(sanitized.claimant.email).toBeUndefined();
    });

    it('masks proof and email from moderator on rejected claim', () => {
      const modView = sanitizeClaimForViewer(rejectedClaim, moderatorId);
      expect(modView.proofText).toBe('[PROTECTED]');
      expect(modView.claimant.email).toBeUndefined();
    });
  });

  describe('Approved & Handoff Confirmed Claims', () => {
    const approvedClaim = { ...baseClaim, status: ClaimStatus.APPROVED };
    const confirmedClaim = { ...baseClaim, status: ClaimStatus.HANDOFF_CONFIRMED };

    it('reveals claimant email to report owner once claim is APPROVED', () => {
      const sanitized = sanitizeClaimForViewer(approvedClaim, ownerId);
      expect(sanitized.claimant.email).toBe('priya@cmrit.ac.in');
      expect(sanitized.proofText).toBe('Confidential serial number: CMRIT-9921');
    });

    it('reveals claimant email to report owner when HANDOFF_CONFIRMED', () => {
      const sanitized = sanitizeClaimForViewer(confirmedClaim, ownerId);
      expect(sanitized.claimant.email).toBe('priya@cmrit.ac.in');
    });

    it('never reveals claimant email to moderators or staff even after approval', () => {
      const modView = sanitizeClaimForViewer(approvedClaim, moderatorId);
      expect(modView.claimant.email).toBeUndefined();
      expect(modView.proofText).toBe('[PROTECTED]');
    });
  });
});
