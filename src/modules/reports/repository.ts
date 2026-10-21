import { Prisma, ReportStatus, ReportType } from '@prisma/client';
import prisma from '@/src/db';
import { CreateReportInput, ListReportsQuery, UpdateReportInput } from './schema';
import { AppError } from '@/src/lib/errors';

export class ReportsRepository {
  async findById(id: string) {
    return prisma.report.findUnique({
      where: { id },
      include: {
        images: {
          select: {
            id: true,
            rawObjectKey: true,
            thumbObjectKey: true,
            status: true,
            width: true,
            height: true,
          },
        },
        _count: {
          select: {
            claims: {
              where: {
                status: {
                  in: ['APPROVED', 'HANDOFF_CONFIRMED'],
                },
              },
            },
          },
        },
      },
    });
  }

  async createWithJobs(userId: string, input: CreateReportInput) {
    return prisma.$transaction(async (tx) => {
      // 1. Verify that all referenced imageIds belong to this user and org, are not yet attached, and are valid/unexpired
      if (input.imageIds && input.imageIds.length > 0) {
        const uniqueImageIds = Array.from(new Set(input.imageIds));
        if (uniqueImageIds.length !== input.imageIds.length) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Duplicate image IDs are not allowed in a report'
          );
        }

        const now = new Date();
        const images = await tx.reportImage.findMany({
          where: {
            id: { in: uniqueImageIds },
            uploaderId: userId,
            organizationId: input.orgId,
            reportId: null,
            OR: [
              { status: 'READY' },
              { status: 'PENDING_UPLOAD', expiresAt: { gt: now } },
            ],
          },
        });

        if (images.length !== uniqueImageIds.length) {
          throw new AppError(
            'VALIDATION_ERROR',
            'One or more image IDs are invalid, do not belong to you, have expired, or have already been attached'
          );
        }
      }

      // 2. Create the Report record
      const report = await tx.report.create({
        data: {
          organizationId: input.orgId,
          ownerId: userId,
          type: input.type as ReportType,
          status: ReportStatus.OPEN,
          category: input.category,
          title: input.title,
          description: input.description,
          color: input.color,
          brand: input.brand,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          locationLabel: input.locationLabel,
          locationArea: input.locationArea,
          version: 1,
        },
      });

      // 3. Attach images and enqueue PROCESS_IMAGE jobs for pending uploads
      if (input.imageIds && input.imageIds.length > 0) {
        await tx.reportImage.updateMany({
          where: { id: { in: input.imageIds } },
          data: { reportId: report.id },
        });

        // Only enqueue image processing jobs for images that are still in PENDING_UPLOAD
        const pendingImages = await tx.reportImage.findMany({
          where: {
            id: { in: input.imageIds },
            status: 'PENDING_UPLOAD',
          },
          select: { id: true },
        });

        for (const img of pendingImages) {
          await tx.job.create({
            data: {
              kind: 'PROCESS_IMAGE',
              dedupeKey: `process_image:${img.id}`,
              payload: { imageId: img.id },
              status: 'QUEUED',
            },
          });
        }
      }

      // 4. Enqueue COMPUTE_MATCHES job
      await tx.job.create({
        data: {
          kind: 'COMPUTE_MATCHES',
          dedupeKey: `compute_matches:${report.id}`,
          payload: {
            reportId: report.id,
            organizationId: report.organizationId,
          },
          status: 'QUEUED',
        },
      });

      return report;
    });
  }

  async list(query: ListReportsQuery) {
    const limit = query.limit;

    if (query.q && query.q.trim().length > 0) {
      const searchTerm = query.q.trim();

      // Hybrid tsvector full-text search + pg_trgm similarity
      const reports = await prisma.$queryRaw<
        Array<{
          id: string;
          organization_id: string;
          owner_id: string;
          type: ReportType;
          status: ReportStatus;
          category: string;
          title: string;
          description: string;
          color: string | null;
          brand: string | null;
          occurred_at: Date | null;
          location_label: string;
          location_area: string | null;
          created_at: Date;
          version: number;
        }>
      >`
        SELECT r.id, r.organization_id, r.owner_id, r.type, r.status, r.category,
               r.title, r.description, r.color, r.brand, r.occurred_at,
               r.location_label, r.location_area, r.created_at, r.version
        FROM reports r
        WHERE r.organization_id = ${query.orgId}::uuid
          AND r.status = 'OPEN'
          ${query.type ? Prisma.sql`AND r.type = ${query.type}::report_type` : Prisma.empty}
          ${query.category ? Prisma.sql`AND r.category = ${query.category}` : Prisma.empty}
          AND (
            r.search_document @@ plainto_tsquery('english', ${searchTerm})
            OR similarity(r.title, ${searchTerm}) > 0.15
          )
        ORDER BY
          ts_rank_cd(r.search_document, plainto_tsquery('english', ${searchTerm})) DESC,
          similarity(r.title, ${searchTerm}) DESC,
          r.created_at DESC
        LIMIT ${limit + 1};
      `;

      const hasNextPage = reports.length > limit;
      const items = hasNextPage ? reports.slice(0, limit) : reports;
      const nextCursor = hasNextPage ? items[items.length - 1].id : null;

      // Attach thumbnails for listed reports
      const reportIds = items.map((r) => r.id);
      const images = await prisma.reportImage.findMany({
        where: {
          reportId: { in: reportIds },
          status: 'READY',
        },
        select: {
          reportId: true,
          thumbObjectKey: true,
        },
      });

      const imageMap = new Map<string, string>();
      for (const img of images) {
        if (img.reportId && img.thumbObjectKey && !imageMap.has(img.reportId)) {
          imageMap.set(img.reportId, img.thumbObjectKey);
        }
      }

      return {
        items: items.map((r) => ({
          id: r.id,
          organizationId: r.organization_id,
          type: r.type,
          status: r.status,
          category: r.category,
          title: r.title,
          description: r.description,
          color: r.color,
          brand: r.brand,
          occurredAt: r.occurred_at,
          locationLabel: r.location_label,
          locationArea: r.location_area,
          createdAt: r.created_at,
          thumbObjectKey: imageMap.get(r.id) || null,
        })),
        nextCursor,
      };
    }

    // Default browse feed with cursor pagination
    const where: Prisma.ReportWhereInput = {
      organizationId: query.orgId,
      status: ReportStatus.OPEN,
      ...(query.type ? { type: query.type as ReportType } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const reports = await prisma.report.findMany({
      where,
      take: limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        images: {
          where: { status: 'READY' },
          select: { thumbObjectKey: true },
          take: 1,
        },
      },
    });

    const hasNextPage = reports.length > limit;
    const items = hasNextPage ? reports.slice(0, limit) : reports;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    return {
      items: items.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        type: r.type,
        status: r.status,
        category: r.category,
        title: r.title,
        description: r.description,
        color: r.color,
        brand: r.brand,
        occurredAt: r.occurredAt,
        locationLabel: r.locationLabel,
        locationArea: r.locationArea,
        createdAt: r.createdAt,
        thumbObjectKey: r.images[0]?.thumbObjectKey || null,
      })),
      nextCursor,
    };
  }

  async updateWithOptimisticLock(id: string, input: UpdateReportInput) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.report.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('NOT_FOUND', 'Report not found');
      }

      if (existing.status !== ReportStatus.OPEN) {
        throw new AppError('INVALID_STATE', `Cannot update a report in '${existing.status}' status`);
      }

      if (existing.version !== input.version) {
        throw new AppError(
          'CONFLICT',
          `Report was modified by another request (version conflict: expected ${existing.version}, received ${input.version})`
        );
      }

      const updated = await tx.report.update({
        where: { id },
        data: {
          title: input.title ?? existing.title,
          description: input.description ?? existing.description,
          category: input.category ?? existing.category,
          color: input.color !== undefined ? input.color : existing.color,
          brand: input.brand !== undefined ? input.brand : existing.brand,
          locationLabel: input.locationLabel ?? existing.locationLabel,
          locationArea: input.locationArea !== undefined ? input.locationArea : existing.locationArea,
          occurredAt: input.occurredAt !== undefined ? (input.occurredAt ? new Date(input.occurredAt) : null) : existing.occurredAt,
          version: existing.version + 1,
        },
      });

      // Re-queue match computation on report content update
      await tx.job.create({
        data: {
          kind: 'COMPUTE_MATCHES',
          dedupeKey: `compute_matches:${updated.id}:${updated.version}`,
          payload: {
            reportId: updated.id,
            organizationId: updated.organizationId,
          },
          status: 'QUEUED',
        },
      });

      return updated;
    });
  }

  async withdrawWithOptimisticLock(id: string, version: number) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.report.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('NOT_FOUND', 'Report not found');
      }

      if (existing.status !== ReportStatus.OPEN) {
        throw new AppError('INVALID_STATE', `Report is already in '${existing.status}' status and cannot be withdrawn`);
      }

      if (existing.version !== version) {
        throw new AppError(
          'CONFLICT',
          `Report was modified by another request (version conflict: expected ${existing.version}, received ${version})`
        );
      }

      const updated = await tx.report.update({
        where: { id },
        data: {
          status: ReportStatus.WITHDRAWN,
          resolvedAt: new Date(),
          version: existing.version + 1,
        },
      });

      // Automatically cancel any remaining pending claims on this report
      await tx.claim.updateMany({
        where: {
          reportId: id,
          status: 'PENDING',
        },
        data: {
          status: 'WITHDRAWN',
        },
      });

      return updated;
    });
  }
}

export const reportsRepository = new ReportsRepository();
