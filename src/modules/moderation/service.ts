import prisma from '@/src/db';
import { moderationPolicy } from './policy';
import { reportsPolicy } from '@/src/modules/reports/policy';
import { FlagReportInput, ModerationActionInput, ListModerationQueueQuery } from './schema';
import { AppError } from '@/src/lib/errors';
import { ReportStatus } from '@prisma/client';

export class ModerationService {
  async flagReport(userId: string, reportId: string, input: FlagReportInput) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    // Enforce tenant isolation
    await reportsPolicy.requireOrgMembership(userId, report.organizationId);

    // Enforce one flag per reporter per report
    const existing = await prisma.moderationReport.findUnique({
      where: {
        reportId_reporterId: {
          reportId,
          reporterId: userId,
        },
      },
    });

    if (existing) {
      throw new AppError('CONFLICT', 'You have already flagged this report');
    }

    const modReport = await prisma.moderationReport.create({
      data: {
        reportId,
        reporterId: userId,
        reason: input.reason,
        status: 'OPEN',
      },
    });

    return { data: { id: modReport.id, status: modReport.status } };
  }

  async getModerationQueue(userId: string, query: ListModerationQueueQuery) {
    await moderationPolicy.requireModerator(userId, query.orgId);

    const flags = await prisma.moderationReport.findMany({
      where: {
        status: query.status,
        report: {
          organizationId: query.orgId,
        },
      },
      include: {
        report: {
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            type: true,
            status: true,
            ownerId: true,
            createdAt: true,
          },
        },
        reporter: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group flags by report
    const reportMap = new Map<
      string,
      {
        report: (typeof flags)[0]['report'];
        flagCount: number;
        flags: Array<{
          id: string;
          reporterId: string;
          reporterName: string;
          reason: string;
          createdAt: Date;
        }>;
      }
    >();

    for (const flag of flags) {
      const existing = reportMap.get(flag.reportId);
      const flagSummary = {
        id: flag.id,
        reporterId: flag.reporterId,
        reporterName: flag.reporter.displayName,
        reason: flag.reason,
        createdAt: flag.createdAt,
      };

      if (existing) {
        existing.flagCount++;
        existing.flags.push(flagSummary);
      } else {
        reportMap.set(flag.reportId, {
          report: flag.report,
          flagCount: 1,
          flags: [flagSummary],
        });
      }
    }

    return { data: Array.from(reportMap.values()) };
  }

  async takeAction(userId: string, reportId: string, input: ModerationActionInput) {
    return prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new AppError('NOT_FOUND', 'Report not found');
      }

      await moderationPolicy.requireModerator(userId, report.organizationId);

      let targetReportStatus = report.status;
      let targetFlagStatus = 'ACTIONED';

      if (input.action === 'HIDE') {
        targetReportStatus = ReportStatus.HIDDEN;
      } else if (input.action === 'RESTORE') {
        targetReportStatus = ReportStatus.OPEN;
      } else if (input.action === 'DISMISS_FLAGS') {
        targetFlagStatus = 'DISMISSED';
      }

      // 1. Update report status if changed
      let updatedReport = report;
      if (targetReportStatus !== report.status) {
        updatedReport = await tx.report.update({
          where: { id: reportId },
          data: {
            status: targetReportStatus,
            version: report.version + 1,
          },
        });
      }

      // 2. Resolve open flags
      await tx.moderationReport.updateMany({
        where: {
          reportId,
          status: 'OPEN',
        },
        data: {
          status: targetFlagStatus,
          reviewedBy: userId,
          reviewNote: input.note,
          reviewedAt: new Date(),
        },
      });

      // 3. Record immutable entry in audit_events
      await tx.auditEvent.create({
        data: {
          organizationId: report.organizationId,
          actorId: userId,
          entityType: 'REPORT',
          entityId: report.id,
          action: input.action,
          metadata: {
            note: input.note,
            previousStatus: report.status,
            updatedStatus: updatedReport.status,
          },
        },
      });

      return updatedReport;
    });
  }
}

export const moderationService = new ModerationService();
