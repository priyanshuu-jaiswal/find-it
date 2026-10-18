import prisma from '@/src/db';
import { AppError } from '@/src/lib/errors';
import { MemberRole, ReportStatus } from '@prisma/client';

export interface ClaimWithReportContext {
  id: string;
  claimantId: string;
  report: {
    id: string;
    ownerId: string;
    organizationId: string;
    status: ReportStatus;
  };
}

export class ClaimsPolicy {
  /**
   * Enforces that non-owners can only claim OPEN reports.
   * Throws 422 INVALID_STATE on self-claim or closed report.
   */
  assertCanSubmitClaim(userId: string, report: { id: string; ownerId: string; status: ReportStatus }) {
    if (report.ownerId === userId) {
      throw new AppError('INVALID_STATE', 'Report owners cannot submit claims on their own reports');
    }

    if (report.status !== ReportStatus.OPEN) {
      throw new AppError('INVALID_STATE', `Claims can only be submitted on OPEN reports (current status: ${report.status})`);
    }
  }

  /**
   * Asserts user is report owner or an organization moderator.
   */
  async assertCanDecideClaim(userId: string, claim: ClaimWithReportContext) {
    if (claim.report.ownerId === userId) {
      return true;
    }

    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: claim.report.organizationId,
          userId,
        },
      },
    });

    if (
      membership &&
      (membership.role === MemberRole.MODERATOR || membership.role === MemberRole.ORG_ADMIN)
    ) {
      return true;
    }

    throw new AppError('FORBIDDEN', 'Only the report owner or an organization moderator can make decisions on claims');
  }

  /**
   * Asserts user is a participant in the claim (claimant, owner, or moderator).
   */
  async assertCanParticipate(userId: string, claim: ClaimWithReportContext) {
    if (claim.claimantId === userId || claim.report.ownerId === userId) {
      return true;
    }

    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: claim.report.organizationId,
          userId,
        },
      },
    });

    if (
      membership &&
      (membership.role === MemberRole.MODERATOR || membership.role === MemberRole.ORG_ADMIN)
    ) {
      return true;
    }

    throw new AppError('FORBIDDEN', 'You do not have permission to view or participate in this claim');
  }

  /**
   * Asserts user is either the claimant or the report owner for handoff confirmation.
   */
  assertCanConfirmHandoff(userId: string, claim: ClaimWithReportContext) {
    if (claim.claimantId !== userId && claim.report.ownerId !== userId) {
      throw new AppError('FORBIDDEN', 'Only the claimant or the report owner can confirm physical handoff');
    }
  }
}

export const claimsPolicy = new ClaimsPolicy();
