import prisma from '@/src/db';
import { AppError } from '@/src/lib/errors';
import { MemberRole } from '@prisma/client';

export class ReportsPolicy {
  /**
   * Asserts that the user belongs to the target organization.
   * Throws 404 NOT_FOUND on failure to prevent UUID enumeration.
   */
  async requireOrgMembership(userId: string, orgId: string) {
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new AppError('NOT_FOUND', 'Organization not found or you are not a member');
    }

    return membership;
  }

  /**
   * Asserts that the user is either the report owner or an organization moderator/admin.
   */
  async requireCanModifyReport(userId: string, report: { ownerId: string; organizationId: string }) {
    if (report.ownerId === userId) {
      return true;
    }

    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: report.organizationId,
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

    throw new AppError('FORBIDDEN', 'Only the report owner or an organization moderator can perform this action');
  }

  /**
   * Asserts that the user is the owner of the report (for report withdrawal).
   */
  requireOwner(userId: string, report: { ownerId: string }) {
    if (report.ownerId !== userId) {
      throw new AppError('FORBIDDEN', 'Only the report owner can withdraw this report');
    }
  }
}

export const reportsPolicy = new ReportsPolicy();
