import crypto from 'crypto';
import prisma from '@/src/db';
import { storageAdapter } from './storage-adapter';
import { PresignUploadInput } from './schema';
import { AppError } from '@/src/lib/errors';
import logger, { sanitizeLogErr } from '@/src/lib/logger';

export interface CleanupSweepOptions {
  olderThanMinutes?: number;
  batchSize?: number;
  cursor?: string;
}

export interface CleanupMetrics {
  totalBacklog: number | null;
  failedAttemptsCount: number | null;
  oldestPendingAgeSeconds: number | null;
  metricsAvailable: boolean;
}

export interface CleanupSweepResult {
  cleanedCount: number;
  failedCount: number;
  processedInBatch: number;
  metricsAvailable: boolean;
  totalBacklog: number | null;
  failedAttemptsCount: number | null;
  oldestPendingAgeSeconds: number | null;
}

/**
 * UPLOAD CLEANUP & RETRY SYSTEM CORE INVARIANTS:
 * 1. Confirmation Before Purge: No image may be marked purged until storage confirms deletion
 *    or confirms the object is already absent (e.g. 404 / NoSuchKey / NotFound).
 * 2. Key & Record Preservation: Failed or unconfigured storage deletion must preserve the object key
 *    and durable database record; errors must never be swallowed to mark work complete.
 * 3. Report Integrity: Attached report-image rows (`reportId !== null`) must never be deleted by orphan
 *    cleanup; only their lingering raw/thumb storage objects are purged, updating keys to `purged:${id}`.
 * 4. Terminal Rejection: Rejected images may be cleaned up from storage, but must never be reprocessed
 *    as valid images.
 * 5. Fair Scheduling & Bounded Backoff: Failed cleanup must be scheduled durably with bounded exponential
 *    backoff (`nextRetryAt`); other eligible records must continue to make progress without head-of-line blocking.
 * 6. Non-Swallowing Fault Tolerance: Storage errors, database errors, job enqueue failures, and cleanup
 *    failures must not be swallowed in a way that marks work complete or loses the only object key.
 * 7. Idempotency: Cleanup and job handling must be strictly idempotent under retries and concurrent worker ticks.
 */

/**
 * Predicate identifying every image or object still requiring cleanup,
 * including records currently waiting for `nextRetryAt`.
 * Used for outstanding backlog counts, failed attempt counts, and oldest pending age.
 */
export function buildOutstandingCleanupWhere(now = new Date(), olderThanMinutes = 15) {
  const threshold = new Date(now.getTime() - olderThanMinutes * 60 * 1000);
  return {
    OR: [
      // 1. Unattached pending uploads that expired or timed out
      { reportId: null, status: 'PENDING_UPLOAD', expiresAt: { lt: now } },
      { reportId: null, status: 'PENDING_UPLOAD', createdAt: { lt: threshold } },
      // 2. Unattached rejected uploads (need full DB row deletion after storage purge)
      { reportId: null, status: 'REJECTED' },
      // 3. READY images whose raw object still needs post-processing purging (whether attached or not)
      { status: 'READY', rawObjectKey: { startsWith: 'raw/' } },
      // 4. REJECTED images whose raw object still needs purging (whether attached to a report or not)
      { status: 'REJECTED', rawObjectKey: { startsWith: 'raw/' } },
      // 5. REJECTED images whose thumbnail object still needs purging (whether attached to a report or not)
      { status: 'REJECTED', thumbObjectKey: { startsWith: 'thumb/' } },
    ],
  };
}

/**
 * Predicate identifying outstanding records whose retry time is null or due.
 * Used exclusively to select the current bounded processing batch.
 */
export function buildEligibleCleanupWhere(now = new Date(), olderThanMinutes = 15) {
  const outstandingWhere = buildOutstandingCleanupWhere(now, olderThanMinutes);
  return {
    AND: [
      outstandingWhere,
      {
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
      },
    ],
  };
}

export class UploadsService {
  async createPresignedUpload(userId: string, input: PresignUploadInput) {
    // 1. Verify user membership in organization (404 on cross-org attempt to prevent UUID enumeration)
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new AppError('NOT_FOUND', 'Organization not found or you are not a member');
    }

    // 2. Generate unique object key
    const imageId = crypto.randomUUID();
    const ext = input.contentType.split('/')[1] || 'bin';
    const rawObjectKey = `raw/${input.orgId}/${imageId}.${ext}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

    // 3. Record pending upload row
    const reportImage = await prisma.reportImage.create({
      data: {
        id: imageId,
        uploaderId: userId,
        organizationId: input.orgId,
        rawObjectKey,
        status: 'PENDING_UPLOAD',
        contentType: input.contentType,
        byteSize: BigInt(input.byteSize),
        sha256: input.sha256,
        expiresAt,
      },
    });

    // 4. Generate presigned PUT URL with bound byte size & content type
    const putUrl = await storageAdapter.getPresignedPutUrl(
      rawObjectKey,
      input.contentType,
      input.byteSize,
      900
    );

    return {
      imageId: reportImage.id,
      putUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Cleans up expired pending uploads that were never attached to a report,
   * unattached rejected images, and orphaned raw storage objects.
   *
   * FAIR SWEEPER & DURABLE RETRY DESIGN:
   * - Bounded Batches: Processes up to `batchSize` records per tick with cursor pagination support.
   * - Starvation Prevention: Failed storage deletions schedule exponential backoff via `nextRetryAt`
   *   and increment `cleanupAttempts`, allowing other eligible records to be processed without starvation.
   * - Report Integrity: Attached report images (`reportId !== null`) are NEVER deleted from the DB;
   *   their raw storage objects are purged and keys updated to `purged:${id}` upon confirmed deletion.
   * - Safe Metrics: Calculates and logs backlog, failed attempts, and oldest pending age without
   *   disclosing secrets, signed URLs, or PII.
   */
  async cleanupAbandonedUploads(
    optionsOrOlderThanMinutes: number | CleanupSweepOptions = 15
  ): Promise<CleanupSweepResult> {
    const olderThanMinutes =
      typeof optionsOrOlderThanMinutes === 'number'
        ? optionsOrOlderThanMinutes
        : optionsOrOlderThanMinutes.olderThanMinutes ?? 15;

    const batchSize =
      typeof optionsOrOlderThanMinutes === 'object' && optionsOrOlderThanMinutes.batchSize
        ? optionsOrOlderThanMinutes.batchSize
        : 50;

    const cursor =
      typeof optionsOrOlderThanMinutes === 'object'
        ? optionsOrOlderThanMinutes.cursor
        : undefined;

    const now = new Date();
    const eligibleWhere = buildEligibleCleanupWhere(now, olderThanMinutes);
    const outstandingWhere = buildOutstandingCleanupWhere(now, olderThanMinutes);

    const candidates = await prisma.reportImage.findMany({
      where: eligibleWhere as any,
      orderBy: [
        { nextRetryAt: 'asc' }, // Prioritize unattempted records, then earliest retries
        { createdAt: 'asc' },   // FIFO fairness
        { id: 'asc' },          // Deterministic tie-breaker
      ],
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    let cleanedCount = 0;
    let failedCount = 0;

    for (const img of candidates) {
      try {
        // Case A: READY image whose raw object still needs post-processing purging
        if (img.status === 'READY') {
          if (
            img.rawObjectKey &&
            !img.rawObjectKey.startsWith('data:') &&
            !img.rawObjectKey.startsWith('purged:')
          ) {
            if (!storageAdapter.isStorageEnabled()) {
              failedCount++;
              const nextAttempts = (img.cleanupAttempts ?? 0) + 1;
              const delaySeconds = Math.min(30 * Math.pow(2, nextAttempts - 1), 3600);
              const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
              await prisma.reportImage.update({
                where: { id: img.id },
                data: {
                  cleanupAttempts: nextAttempts,
                  nextRetryAt,
                },
              });
              logger.warn(
                { imageId: img.id, cleanupAttempts: nextAttempts, nextRetryAt: nextRetryAt.toISOString() },
                'Storage is unconfigured; cannot delete raw object for READY image during sweep; scheduled retry with backoff'
              );
            } else {
              try {
                await storageAdapter.deleteObject(img.rawObjectKey);
                await prisma.reportImage.update({
                  where: { id: img.id },
                  data: {
                    rawObjectKey: `purged:${img.id}`,
                    cleanupAttempts: 0,
                    nextRetryAt: null,
                  },
                });
                cleanedCount++;
              } catch (err) {
                failedCount++;
                const nextAttempts = (img.cleanupAttempts ?? 0) + 1;
                const delaySeconds = Math.min(30 * Math.pow(2, nextAttempts - 1), 3600);
                const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
                await prisma.reportImage.update({
                  where: { id: img.id },
                  data: {
                    cleanupAttempts: nextAttempts,
                    nextRetryAt,
                  },
                });
                logger.warn(
                  { imageId: img.id, cleanupAttempts: nextAttempts, nextRetryAt: nextRetryAt.toISOString(), ...sanitizeLogErr(err) },
                  'Failed to delete raw object for READY image during sweep; scheduled retry with backoff'
                );
              }
            }
          }
          continue;
        }

        // Case B: Attached REJECTED image (reportId !== null)
        // Must purge raw storage object and thumbnail, but PRESERVE the database row to protect report integrity
        if (img.reportId !== null) {
          let attachedFailed = false;
          let rawPurged =
            !img.rawObjectKey ||
            img.rawObjectKey.startsWith('data:') ||
            img.rawObjectKey.startsWith('purged:');
          let thumbPurged =
            !img.thumbObjectKey ||
            img.thumbObjectKey.startsWith('data:') ||
            img.thumbObjectKey.startsWith('purged:');

          if (!rawPurged) {
            if (!storageAdapter.isStorageEnabled()) {
              attachedFailed = true;
            } else {
              try {
                await storageAdapter.deleteObject(img.rawObjectKey);
                rawPurged = true;
                await prisma.reportImage.update({
                  where: { id: img.id },
                  data: { rawObjectKey: `purged:${img.id}` },
                });
              } catch (err) {
                attachedFailed = true;
                logger.warn(
                  { imageId: img.id, reportId: img.reportId, ...sanitizeLogErr(err) },
                  'Failed to delete raw object for attached rejected image during sweep'
                );
              }
            }
          }

          if (!thumbPurged) {
            if (!storageAdapter.isStorageEnabled()) {
              attachedFailed = true;
            } else {
              try {
                await storageAdapter.deleteObject(img.thumbObjectKey!);
                thumbPurged = true;
                await prisma.reportImage.update({
                  where: { id: img.id },
                  data: { thumbObjectKey: `purged:${img.id}` },
                });
              } catch (err) {
                attachedFailed = true;
                logger.warn(
                  { imageId: img.id, reportId: img.reportId, ...sanitizeLogErr(err) },
                  'Failed to delete thumb object for attached rejected image during sweep'
                );
              }
            }
          }

          if (attachedFailed) {
            failedCount++;
            const nextAttempts = (img.cleanupAttempts ?? 0) + 1;
            const delaySeconds = Math.min(30 * Math.pow(2, nextAttempts - 1), 3600);
            const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
            await prisma.reportImage.update({
              where: { id: img.id },
              data: {
                cleanupAttempts: nextAttempts,
                nextRetryAt,
              },
            });
            logger.warn(
              { imageId: img.id, reportId: img.reportId, cleanupAttempts: nextAttempts, nextRetryAt: nextRetryAt.toISOString() },
              'Attached rejected image cleanup failed; scheduled retry with backoff'
            );
          } else if (rawPurged && thumbPurged) {
            // Both objects confirmed purged. Reset retry state on the preserved DB row.
            await prisma.reportImage.update({
              where: { id: img.id },
              data: {
                cleanupAttempts: 0,
                nextRetryAt: null,
              },
            });
            cleanedCount++;
          }

          continue;
        }

        // Case C: Unattached expired or rejected upload (reportId === null)
        let rawDeleted =
          !img.rawObjectKey ||
          img.rawObjectKey.startsWith('data:') ||
          img.rawObjectKey.startsWith('purged:');

        if (!rawDeleted) {
          if (!storageAdapter.isStorageEnabled()) {
            rawDeleted = false;
            logger.warn(
              { imageId: img.id },
              'Storage is unconfigured; cannot delete remote raw object during sweep'
            );
          } else {
            try {
              await storageAdapter.deleteObject(img.rawObjectKey);
              rawDeleted = true;
            } catch (rawErr) {
              rawDeleted = false;
              logger.warn(
                { imageId: img.id, ...sanitizeLogErr(rawErr) },
                'Failed to delete raw object from storage; retaining row for retry'
              );
            }
          }
        }

        let thumbDeleted =
          !img.thumbObjectKey ||
          img.thumbObjectKey.startsWith('data:') ||
          img.thumbObjectKey.startsWith('purged:');

        if (!thumbDeleted) {
          if (!storageAdapter.isStorageEnabled()) {
            thumbDeleted = false;
            logger.warn(
              { imageId: img.id },
              'Storage is unconfigured; cannot delete remote thumb object during sweep'
            );
          } else {
            try {
              await storageAdapter.deleteObject(img.thumbObjectKey!);
              thumbDeleted = true;
            } catch (thumbErr) {
              thumbDeleted = false;
              logger.warn(
                { imageId: img.id, ...sanitizeLogErr(thumbErr) },
                'Failed to delete thumb object from storage; retaining row for retry'
              );
            }
          }
        }

        // Only delete the database record IF all storage objects were confirmed deleted
        if (rawDeleted && thumbDeleted) {
          await prisma.reportImage.delete({ where: { id: img.id } });
          cleanedCount++;
        } else {
          failedCount++;
          const nextAttempts = (img.cleanupAttempts ?? 0) + 1;
          const delaySeconds = Math.min(30 * Math.pow(2, nextAttempts - 1), 3600);
          const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
          await prisma.reportImage.update({
            where: { id: img.id },
            data: {
              cleanupAttempts: nextAttempts,
              nextRetryAt,
              status: img.status === 'PENDING_UPLOAD' ? 'REJECTED' : undefined,
              rawObjectKey:
                rawDeleted && img.rawObjectKey && !img.rawObjectKey.startsWith('purged:')
                  ? `purged:${img.id}`
                  : undefined,
              thumbObjectKey:
                thumbDeleted && img.thumbObjectKey && !img.thumbObjectKey.startsWith('purged:')
                  ? `purged:${img.id}`
                  : undefined,
            },
          });
          logger.warn(
            { imageId: img.id, cleanupAttempts: nextAttempts, nextRetryAt: nextRetryAt.toISOString() },
            'Unattached upload cleanup failed; scheduled retry with backoff'
          );
        }
      } catch (err) {
        failedCount++;
        logger.warn(
          { imageId: img.id, ...sanitizeLogErr(err) },
          'Error cleaning candidate upload; retaining row for later retry'
        );
      }
    }

    // Calculate safe operational metrics for all outstanding backlog without exposing sensitive data or signed URLs
    let totalBacklog: number | null = null;
    let failedAttemptsCount: number | null = null;
    let oldestPendingAgeSeconds: number | null = null;
    let metricsAvailable = false;

    try {
      if (typeof prisma.reportImage.count === 'function') {
        const [backlogCount, failedCountDb, oldestRecord] = await Promise.all([
          prisma.reportImage.count({ where: outstandingWhere as any }),
          prisma.reportImage.count({
            where: {
              AND: [
                outstandingWhere as any,
                { cleanupAttempts: { gt: 0 } },
              ],
            },
          }),
          typeof prisma.reportImage.findFirst === 'function'
            ? prisma.reportImage.findFirst({
                where: outstandingWhere as any,
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
              })
            : Promise.resolve(null),
        ]);

        totalBacklog = backlogCount;
        failedAttemptsCount = failedCountDb;
        metricsAvailable = true;
        if (oldestRecord?.createdAt) {
          oldestPendingAgeSeconds = Math.max(
            0,
            Math.floor((now.getTime() - new Date(oldestRecord.createdAt).getTime()) / 1000)
          );
        }
      }
    } catch (err) {
      // Metrics collection should not fail the sweep, but make unavailable metrics explicit.
      logger.warn({ ...sanitizeLogErr(err) }, 'Cleanup backlog metrics unavailable for this sweep');
      totalBacklog = null;
      failedAttemptsCount = null;
      oldestPendingAgeSeconds = null;
      metricsAvailable = false;
    }

    logger.info(
      {
        batchSize,
        processedInBatch: candidates.length,
        cleanedCount,
        failedCount,
        totalBacklog,
        failedAttemptsCount,
        oldestPendingAgeSeconds,
        metricsAvailable,
      },
      'Abandoned upload and orphaned object sweep completed'
    );

    return {
      cleanedCount,
      failedCount,
      processedInBatch: candidates.length,
      metricsAvailable,
      totalBacklog,
      failedAttemptsCount,
      oldestPendingAgeSeconds,
    };
  }

  /**
   * Retrieves safe operational metrics regarding the abandoned upload and orphaned object backlog.
   * Tracks all outstanding cleanup work regardless of whether individual items are in backoff delays.
   * Note: This is an internal operational helper function and is not directly exposed as a public API route.
   */
  async getCleanupMetrics(olderThanMinutes = 15): Promise<CleanupMetrics> {
    const now = new Date();
    const outstandingWhere = buildOutstandingCleanupWhere(now, olderThanMinutes);

    let totalBacklog: number | null = null;
    let failedAttemptsCount: number | null = null;
    let oldestPendingAgeSeconds: number | null = null;
    let metricsAvailable = false;

    if (typeof prisma.reportImage.count === 'function') {
      try {
        const [backlogCount, failedCountDb, oldestRecord] = await Promise.all([
          prisma.reportImage.count({ where: outstandingWhere as any }),
          prisma.reportImage.count({
            where: {
              AND: [
                outstandingWhere as any,
                { cleanupAttempts: { gt: 0 } },
              ],
            },
          }),
          typeof prisma.reportImage.findFirst === 'function'
            ? prisma.reportImage.findFirst({
                where: outstandingWhere as any,
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
              })
            : Promise.resolve(null),
        ]);

        totalBacklog = backlogCount;
        failedAttemptsCount = failedCountDb;
        metricsAvailable = true;
        if (oldestRecord?.createdAt) {
          oldestPendingAgeSeconds = Math.max(
            0,
            Math.floor((now.getTime() - new Date(oldestRecord.createdAt).getTime()) / 1000)
          );
        }
      } catch (err) {
        logger.warn({ ...sanitizeLogErr(err) }, 'Failed to query cleanup metrics');
        totalBacklog = null;
        failedAttemptsCount = null;
        oldestPendingAgeSeconds = null;
        metricsAvailable = false;
      }
    }

    return {
      totalBacklog,
      failedAttemptsCount,
      oldestPendingAgeSeconds,
      metricsAvailable,
    };
  }
}

export const uploadsService = new UploadsService();
