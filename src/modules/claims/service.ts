import prisma from '@/src/db';
import { claimsPolicy } from './policy';
import { reportsPolicy } from '@/src/modules/reports/policy';
import {
  CreateClaimInput,
  ClaimDecisionInput,
  ListClaimsQuery,
  ConfirmHandoffInput,
} from './schema';
import { AppError } from '@/src/lib/errors';
import { ClaimStatus, MemberRole, Prisma, ReportStatus, ReportType } from '@prisma/client';

export class ClaimsService {
  async submitClaim(userId: string, reportId: string, input: CreateClaimInput) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    // Enforce tenant isolation (404)
    await reportsPolicy.requireOrgMembership(userId, report.organizationId);

    // Enforce self-claim and OPEN status guards (422)
    claimsPolicy.assertCanSubmitClaim(userId, report);

    // Enforce one claim per user per report (409)
    const existing = await prisma.claim.findUnique({
      where: {
        reportId_claimantId: {
          reportId,
          claimantId: userId,
        },
      },
    });

    if (existing) {
      throw new AppError('CONFLICT', 'You have already submitted a claim for this report');
    }

    const claim = await prisma.claim.create({
      data: {
        reportId,
        claimantId: userId,
        proofText: input.proofText,
        status: ClaimStatus.PENDING,
      },
    });

    return { data: claim };
  }

  async listClaims(userId: string, query: ListClaimsQuery) {
    const membership = await reportsPolicy.requireOrgMembership(userId, query.orgId);
    const isModerator =
      membership.role === MemberRole.MODERATOR || membership.role === MemberRole.ORG_ADMIN;

    const limit = query.limit;
    let whereClause: Prisma.ClaimWhereInput;

    if (query.box === 'outgoing') {
      whereClause = {
        claimantId: userId,
        report: { organizationId: query.orgId },
        ...(query.status ? { status: query.status as ClaimStatus } : {}),
      };
    } else {
      // Incoming box: report owners see claims on their reports; moderators can see all org claims
      whereClause = {
        report: {
          organizationId: query.orgId,
          ...(isModerator ? {} : { ownerId: userId }),
        },
        ...(query.status ? { status: query.status as ClaimStatus } : {}),
      };
    }

    const claims = await prisma.claim.findMany({
      where: whereClause,
      take: limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        report: {
          select: {
            id: true,
            title: true,
            type: true,
            category: true,
            status: true,
            ownerId: true,
            createdAt: true,
          },
        },
        claimant: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    });

    const hasNextPage = claims.length > limit;
    const items = hasNextPage ? claims.slice(0, limit) : claims;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    // Filter proofText and contact visibility:
    // Proof is only visible to the owner and the claimant themselves
    // Contact email is strictly restricted:
    // - Always visible to the claimant themselves
    // - Visible to the report owner ONLY AFTER the claim is APPROVED or HANDOFF_CONFIRMED
    // - Hidden from moderators and third-party members to preserve PII
    const sanitizedItems = items.map((c) => {
      const isOwner = c.report.ownerId === userId;
      const isClaimant = c.claimantId === userId;
      const isHandoffReady =
        c.status === ClaimStatus.APPROVED || c.status === ClaimStatus.HANDOFF_CONFIRMED;

      const canSeeProof = isOwner || isClaimant;
      const canSeeContact = isClaimant || (isOwner && isHandoffReady);

      return {
        id: c.id,
        reportId: c.reportId,
        claimantId: c.claimantId,
        status: c.status,
        proofText: canSeeProof ? c.proofText : '[PROTECTED]',
        decisionBy: c.decisionBy,
        decisionNote: c.decisionNote,
        createdAt: c.createdAt,
        decidedAt: c.decidedAt,
        report: c.report,
        claimant: {
          id: c.claimant.id,
          displayName: c.claimant.displayName,
          email: canSeeContact ? c.claimant.email : undefined,
        },
      };
    });

    return {
      data: sanitizedItems,
      page: {
        nextCursor,
      },
    };
  }

  async decideClaim(userId: string, claimId: string, input: ClaimDecisionInput) {
    return prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findUnique({
        where: { id: claimId },
        include: { report: true },
      });

      if (!claim) {
        throw new AppError('NOT_FOUND', 'Claim not found');
      }

      await claimsPolicy.assertCanDecideClaim(userId, claim);

      // 1. Row-lock parent report to prevent concurrent approval race conditions
      const [lockedReport] = await tx.$queryRaw<Array<{ id: string; status: ReportStatus }>>`
        SELECT id, status FROM reports WHERE id = ${claim.reportId}::uuid FOR UPDATE;
      `;

      if (!lockedReport || lockedReport.status !== ReportStatus.OPEN) {
        throw new AppError('INVALID_STATE', 'Report is no longer OPEN for claim approval');
      }

      // 2. Enforce single active approval lock
      if (input.decision === 'APPROVED') {
        const activeApproved = await tx.claim.findFirst({
          where: {
            reportId: claim.reportId,
            status: { in: [ClaimStatus.APPROVED, ClaimStatus.HANDOFF_CONFIRMED] },
            id: { not: claimId },
          },
        });

        if (activeApproved) {
          throw new AppError(
            'CONFLICT',
            'Another claim has already been approved or confirmed for this report'
          );
        }
      }

      const updated = await tx.claim.update({
        where: { id: claimId },
        data: {
          status: input.decision as ClaimStatus,
          decisionBy: userId,
          decisionNote: input.decisionNote ?? null,
          decidedAt: new Date(),
        },
      });

      return updated;
    });
  }

  async getMessages(userId: string, claimId: string) {
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: { report: true },
    });

    if (!claim) {
      throw new AppError('NOT_FOUND', 'Claim not found');
    }

    await claimsPolicy.assertCanParticipate(userId, claim);

    const messages = await prisma.claimMessage.findMany({
      where: { claimId },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      data: messages.map((m) => ({
        id: m.id,
        claimId: m.claimId,
        senderId: m.senderId,
        senderName: m.sender.displayName,
        body: m.body,
        createdAt: m.createdAt,
      })),
    };
  }

  async postMessage(userId: string, claimId: string, body: string) {
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: { report: true },
    });

    if (!claim) {
      throw new AppError('NOT_FOUND', 'Claim not found');
    }

    await claimsPolicy.assertCanParticipate(userId, claim);

    // Gated handoff chat: Messaging is only unlocked once the claim is APPROVED
    if (claim.status !== ClaimStatus.APPROVED) {
      throw new AppError(
        'INVALID_STATE',
        `Messaging is only available when the claim is in APPROVED status for handoff coordination (current: ${claim.status})`
      );
    }

    const message = await prisma.claimMessage.create({
      data: {
        claimId,
        senderId: userId,
        body,
      },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    return {
      data: {
        id: message.id,
        claimId: message.claimId,
        senderId: message.senderId,
        senderName: message.sender.displayName,
        body: message.body,
        createdAt: message.createdAt,
      },
    };
  }

  async confirmHandoff(userId: string, claimId: string, input: ConfirmHandoffInput) {
    return prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findUnique({
        where: { id: claimId },
        include: { report: true },
      });

      if (!claim) {
        throw new AppError('NOT_FOUND', 'Claim not found');
      }

      // Assert caller is either the claimant or the report owner
      claimsPolicy.assertCanConfirmHandoff(userId, claim);

      if (claim.status !== ClaimStatus.APPROVED) {
        throw new AppError(
          'INVALID_STATE',
          `Only an APPROVED claim can be confirmed for handoff (current: ${claim.status})`
        );
      }

      // 1. Row-lock parent report
      const [lockedReport] = await tx.$queryRaw<Array<{ id: string; status: ReportStatus; version: number }>>`
        SELECT id, status, version FROM reports WHERE id = ${claim.reportId}::uuid FOR UPDATE;
      `;

      if (!lockedReport || lockedReport.status !== ReportStatus.OPEN) {
        throw new AppError('INVALID_STATE', 'Parent report is no longer OPEN');
      }

      // 2. Mark claim HANDOFF_CONFIRMED
      const confirmedClaim = await tx.claim.update({
        where: { id: claimId },
        data: {
          status: ClaimStatus.HANDOFF_CONFIRMED,
          decisionNote: input.note ? `${claim.decisionNote ? claim.decisionNote + ' | ' : ''}Handoff Note: ${input.note}` : claim.decisionNote,
        },
      });

      // 3. Atomically transition parent report to RESOLVED
      await tx.report.update({
        where: { id: claim.reportId },
        data: {
          status: ReportStatus.RESOLVED,
          resolvedAt: new Date(),
          version: lockedReport.version + 1,
        },
      });

      // 4. Auto-reject remaining PENDING claims on this report
      await tx.claim.updateMany({
        where: {
          reportId: claim.reportId,
          status: ClaimStatus.PENDING,
        },
        data: {
          status: ClaimStatus.REJECTED,
          decisionNote: 'Auto-rejected: item handoff was confirmed via another claim',
          decidedAt: new Date(),
        },
      });

      // 5. Auto-resolve linked opposite reports owned by claimant
      const oppositeType =
        claim.report.type === ReportType.FOUND ? ReportType.LOST : ReportType.FOUND;

      const linkedMatches = await tx.reportMatch.findMany({
        where: {
          organizationId: claim.report.organizationId,
          OR: [
            { lostReportId: claim.reportId },
            { foundReportId: claim.reportId },
          ],
        },
        select: {
          lostReportId: true,
          foundReportId: true,
        },
      });

      const matchedReportIds = linkedMatches.map((m) =>
        m.lostReportId === claim.reportId ? m.foundReportId : m.lostReportId
      );

      await tx.report.updateMany({
        where: {
          organizationId: claim.report.organizationId,
          ownerId: claim.claimantId,
          type: oppositeType,
          status: ReportStatus.OPEN,
          OR: [
            { category: claim.report.category },
            ...(matchedReportIds.length > 0 ? [{ id: { in: matchedReportIds } }] : []),
          ],
        },
        data: {
          status: ReportStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      });

      return confirmedClaim;
    });
  }
}

export const claimsService = new ClaimsService();
