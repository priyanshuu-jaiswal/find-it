import prisma from '@/src/db';
import { reportsPolicy } from '@/src/modules/reports/policy';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { MatchFeedbackInput } from './schema';
import { AppError } from '@/src/lib/errors';

export class MatchingService {
  async getMatchesForReport(userId: string, reportId: string, includeDismissed = false) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    // Enforce tenant membership and Owner/Moderator authorization
    await reportsPolicy.requireOrgMembership(userId, report.organizationId);
    await reportsPolicy.requireCanModifyReport(userId, report);

    const matches = await prisma.reportMatch.findMany({
      where: {
        OR: [{ lostReportId: reportId }, { foundReportId: reportId }],
      },
      include: {
        lostReport: {
          include: {
            images: {
              where: { status: 'READY' },
              select: { thumbObjectKey: true },
              take: 1,
            },
          },
        },
        foundReport: {
          include: {
            images: {
              where: { status: 'READY' },
              select: { thumbObjectKey: true },
              take: 1,
            },
          },
        },
        feedbacks: {
          where: { userId },
          select: { dismissed: true, useful: true },
        },
      },
      orderBy: { score: 'desc' },
    });

    // Filter dismissed matches if requested
    const filtered = includeDismissed
      ? matches
      : matches.filter((m) => !m.feedbacks[0]?.dismissed);

    const results = await Promise.all(
      filtered.map(async (m) => {
        const candidate = m.lostReportId === reportId ? m.foundReport : m.lostReport;

        let thumbUrl: string | null = null;
        if (candidate.images[0]?.thumbObjectKey) {
          const key = candidate.images[0].thumbObjectKey;
          if (key.startsWith('data:')) {
            thumbUrl = key;
          } else {
            try {
              thumbUrl = await storageAdapter.getPresignedGetUrl(key, 3600);
            } catch {
              thumbUrl = null;
            }
          }
        }

        return {
          matchId: m.id,
          score: m.score,
          reasons: m.reasons,
          dismissed: m.feedbacks[0]?.dismissed ?? false,
          useful: m.feedbacks[0]?.useful ?? null,
          candidateReport: {
            id: candidate.id,
            type: candidate.type,
            category: candidate.category,
            title: candidate.title,
            description: candidate.description,
            color: candidate.color,
            brand: candidate.brand,
            locationLabel: candidate.locationLabel,
            locationArea: candidate.locationArea,
            occurredAt: candidate.occurredAt,
            createdAt: candidate.createdAt,
            thumbUrl,
          },
        };
      })
    );

    return { data: results };
  }

  async recordFeedback(userId: string, matchId: string, input: MatchFeedbackInput) {
    const match = await prisma.reportMatch.findUnique({
      where: { id: matchId },
      include: {
        lostReport: { select: { ownerId: true } },
        foundReport: { select: { ownerId: true } },
      },
    });

    if (!match) {
      throw new AppError('NOT_FOUND', 'Match not found');
    }

    // Verify user is either report owner or moderator
    await reportsPolicy.requireOrgMembership(userId, match.organizationId);

    const isOwner =
      match.lostReport.ownerId === userId || match.foundReport.ownerId === userId;

    if (!isOwner) {
      const membership = await prisma.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: match.organizationId,
            userId,
          },
        },
      });

      if (!membership || (membership.role !== 'MODERATOR' && membership.role !== 'ORG_ADMIN')) {
        throw new AppError('FORBIDDEN', 'Only participants in this match can submit feedback');
      }
    }

    await prisma.matchFeedback.upsert({
      where: {
        matchId_userId: {
          matchId,
          userId,
        },
      },
      update: {
        ...(input.useful !== undefined ? { useful: input.useful } : {}),
        ...(input.dismissed !== undefined ? { dismissed: input.dismissed } : {}),
      },
      create: {
        matchId,
        userId,
        useful: input.useful ?? null,
        dismissed: input.dismissed ?? false,
      },
    });
  }
}

export const matchingService = new MatchingService();
