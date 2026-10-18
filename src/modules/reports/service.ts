import { reportsRepository } from './repository';
import { reportsPolicy } from './policy';
import { CreateReportInput, ListReportsQuery, UpdateReportInput } from './schema';
import { storageAdapter } from '../uploads/storage-adapter';
import { AppError } from '@/src/lib/errors';

export class ReportsService {
  async createReport(userId: string, input: CreateReportInput) {
    // Enforce tenant membership (cross-org attempts return 404)
    await reportsPolicy.requireOrgMembership(userId, input.orgId);
    return reportsRepository.createWithJobs(userId, input);
  }

  async listReports(userId: string, query: ListReportsQuery) {
    await reportsPolicy.requireOrgMembership(userId, query.orgId);

    const { items, nextCursor } = await reportsRepository.list(query);

    // Generate signed thumbnail URLs for each item
    const enhancedItems = await Promise.all(
      items.map(async (item) => {
        let thumbUrl: string | null = null;
        if (item.thumbObjectKey) {
          try {
            thumbUrl = await storageAdapter.getPresignedGetUrl(item.thumbObjectKey, 3600);
          } catch {
            thumbUrl = null;
          }
        }
        return {
          id: item.id,
          organizationId: item.organizationId,
          type: item.type,
          status: item.status,
          category: item.category,
          title: item.title,
          description: item.description,
          color: item.color,
          brand: item.brand,
          occurredAt: item.occurredAt,
          locationLabel: item.locationLabel,
          locationArea: item.locationArea,
          createdAt: item.createdAt,
          thumbUrl,
        };
      })
    );

    return {
      data: enhancedItems,
      page: {
        nextCursor,
      },
    };
  }

  async getReportById(userId: string, id: string) {
    const report = await reportsRepository.findById(id);
    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    // Enforce org membership; cross-org requests return 404 to prevent UUID enumeration
    await reportsPolicy.requireOrgMembership(userId, report.organizationId);

    // Generate signed GET URLs for all ready thumbnails (never exposing raw image with GPS metadata)
    const images = await Promise.all(
      report.images
        .filter((img) => img.status === 'READY' && img.thumbObjectKey)
        .map(async (img) => {
          const url = await storageAdapter.getPresignedGetUrl(img.thumbObjectKey!, 3600);
          return {
            id: img.id,
            url,
            width: img.width,
            height: img.height,
          };
        })
    );

    return {
      data: {
        id: report.id,
        organizationId: report.organizationId,
        ownerId: report.ownerId,
        type: report.type,
        status: report.status,
        category: report.category,
        title: report.title,
        description: report.description,
        color: report.color,
        brand: report.brand,
        occurredAt: report.occurredAt,
        locationLabel: report.locationLabel,
        locationArea: report.locationArea,
        version: report.version,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        resolvedAt: report.resolvedAt,
        images,
        activeClaimCount: report._count.claims,
      },
    };
  }

  async updateReport(userId: string, id: string, input: UpdateReportInput) {
    const report = await reportsRepository.findById(id);
    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    await reportsPolicy.requireOrgMembership(userId, report.organizationId);
    await reportsPolicy.requireCanModifyReport(userId, report);

    const updated = await reportsRepository.updateWithOptimisticLock(id, input);
    return { data: updated };
  }

  async withdrawReport(userId: string, id: string, version: number) {
    const report = await reportsRepository.findById(id);
    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    await reportsPolicy.requireOrgMembership(userId, report.organizationId);
    reportsPolicy.requireOwner(userId, report);

    const withdrawn = await reportsRepository.withdrawWithOptimisticLock(id, version);
    return { data: withdrawn };
  }
}

export const reportsService = new ReportsService();
