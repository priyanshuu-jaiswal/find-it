import prisma from '@/src/db';
import { scoreCandidatePair, MATCH_THRESHOLD, ALGORITHM_VERSION, ScorableReport } from './score';
import { ReportStatus, ReportType } from '@prisma/client';
import logger from '@/src/lib/logger';

export class CandidatesService {
  /**
   * Pre-filters candidates and computes matches for a given report.
   * Upserts matches with score >= 0.35 into report_matches using canonical (LOST, FOUND) ordering.
   */
  async computeMatchesForReport(reportId: string, organizationId: string): Promise<number> {
    const target = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!target || target.status !== ReportStatus.OPEN) {
      logger.info({ reportId }, 'Target report is not found or not in OPEN status; skipping matching');
      return 0;
    }

    const oppositeType: ReportType = target.type === 'LOST' ? 'FOUND' : 'LOST';

    // 1. Candidate pre-filter query
    // Same org, OPEN status, opposite type, different owner (no self-matching), within temporal bounds
    const candidates = await prisma.report.findMany({
      where: {
        organizationId,
        status: ReportStatus.OPEN,
        type: oppositeType,
        id: { not: target.id },
        ownerId: { not: target.ownerId }, // Self-matches never appear
      },
    });

    if (candidates.length === 0) {
      return 0;
    }

    let matchCount = 0;

    for (const candidate of candidates) {
      // Temporal pre-filter: within 60 days of each other if both timestamps exist
      if (target.occurredAt && candidate.occurredAt) {
        const diffDays =
          Math.abs(target.occurredAt.getTime() - candidate.occurredAt.getTime()) /
          (1000 * 60 * 60 * 24);

        if (diffDays > 60) {
          continue;
        }

        // Temporal ordering: found item occurred at least (lost - 48 hours)
        const lostTime = target.type === 'LOST' ? target.occurredAt : candidate.occurredAt;
        const foundTime = target.type === 'FOUND' ? target.occurredAt : candidate.occurredAt;
        const minFoundTime = new Date(lostTime.getTime() - 48 * 60 * 60 * 1000);

        if (foundTime < minFoundTime) {
          continue;
        }
      }

      // Canonical directional pairing: (LOST, FOUND)
      const lostReport: ScorableReport = target.type === 'LOST' ? target : candidate;
      const foundReport: ScorableReport = target.type === 'FOUND' ? target : candidate;

      const result = scoreCandidatePair(lostReport, foundReport);

      if (result.score >= MATCH_THRESHOLD) {
        // Atomic upsert into report_matches
        await prisma.reportMatch.upsert({
          where: {
            lostReportId_foundReportId: {
              lostReportId: lostReport.id,
              foundReportId: foundReport.id,
            },
          },
          update: {
            score: result.score,
            reasons: result.reasons,
            algorithmVersion: ALGORITHM_VERSION,
            updatedAt: new Date(),
          },
          create: {
            organizationId,
            lostReportId: lostReport.id,
            foundReportId: foundReport.id,
            score: result.score,
            reasons: result.reasons,
            algorithmVersion: ALGORITHM_VERSION,
          },
        });

        matchCount++;
      }
    }

    logger.info({ reportId, matchCount, totalCandidates: candidates.length }, 'Candidate matching completed');
    return matchCount;
  }
}

export const candidatesService = new CandidatesService();
