import prisma from '@/src/db';
import { AppError } from '@/src/lib/errors';
import { MemberRole } from '@prisma/client';

export class ModerationPolicy {
  /**
   * Asserts that the user is an organization MODERATOR or ORG_ADMIN.
   * Throws 404 NOT_FOUND for non-members (tenant isolation) and 403 FORBIDDEN for regular members.
   */
  async requireModerator(userId: string, orgId: string) {
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

    if (
      membership.role !== MemberRole.MODERATOR &&
      membership.role !== MemberRole.ORG_ADMIN
    ) {
      throw new AppError('FORBIDDEN', 'Moderator permissions required for this action');
    }

    return membership;
  }
}

export const moderationPolicy = new ModerationPolicy();
