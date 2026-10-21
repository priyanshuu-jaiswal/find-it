import prisma from '@/src/db';
import logger, { sanitizeLogErr } from '@/src/lib/logger';
import {
  handleProcessImage,
  handleComputeMatches,
  handlePurgeStorageObject,
  ProcessImagePayload,
  ComputeMatchesPayload,
  PurgeStoragePayload,
} from './handlers';
import { uploadsService, CleanupSweepResult } from '@/src/modules/uploads/service';

export interface CleanupSweepSummary {
  success: boolean;
  cleanedCount: number;
  failedCount: number;
  processedInBatch: number;
  metricsAvailable: boolean;
  totalBacklog: number | null;
  failedAttemptsCount: number | null;
  oldestPendingAgeSeconds: number | null;
  error?: string;
}

export interface WorkerTickResult {
  processed: number;
  errors: number;
  jobs: {
    processed: number;
    errors: number;
  };
  cleanup: CleanupSweepSummary;
}

interface LockedJobRow {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export class JobRunner {
  /**
   * Processes a single batch of available jobs using PostgreSQL FOR UPDATE SKIP LOCKED.
   * Returns the count of jobs successfully processed and cleanup sweep status.
   */
  async tick(batchSize = 10): Promise<WorkerTickResult> {
    let processedCount = 0;
    let errorCount = 0;

    // Periodically sweep expired pending uploads & orphaned storage objects
    let cleanupSummary: CleanupSweepSummary;
    try {
      const sweep = await uploadsService.cleanupAbandonedUploads();
      cleanupSummary = {
        success: sweep.failedCount === 0,
        cleanedCount: sweep.cleanedCount,
        failedCount: sweep.failedCount,
        processedInBatch: sweep.processedInBatch,
        metricsAvailable: sweep.metricsAvailable,
        totalBacklog: sweep.totalBacklog,
        failedAttemptsCount: sweep.failedAttemptsCount,
        oldestPendingAgeSeconds: sweep.oldestPendingAgeSeconds,
        error: sweep.failedCount > 0 ? 'STORAGE_DELETION_FAILED' : undefined,
      };
    } catch (err: unknown) {
      logger.warn(
        { ...sanitizeLogErr(err) },
        'Error during periodic abandoned uploads cleanup sweep'
      );
      cleanupSummary = {
        success: false,
        cleanedCount: 0,
        failedCount: 0,
        processedInBatch: 0,
        metricsAvailable: false,
        totalBacklog: null,
        failedAttemptsCount: null,
        oldestPendingAgeSeconds: null,
        error: 'CLEANUP_SWEEP_FAILED',
      };
    }

    // 1. Atomically lock candidate jobs
    const jobsToRun = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedJobRow[]>`
        SELECT id, kind, payload, attempts, max_attempts
        FROM jobs
        WHERE status = 'QUEUED'
          AND available_at <= now()
        ORDER BY available_at ASC, created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED;
      `;

      if (rows.length === 0) {
        return [];
      }

      const jobIds = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE jobs
        SET status = 'RUNNING',
            locked_at = now(),
            attempts = attempts + 1
        WHERE id = ANY(${jobIds}::uuid[]);
      `;

      return rows;
    });

    if (jobsToRun.length === 0) {
      return {
        processed: 0,
        errors: 0,
        jobs: { processed: 0, errors: 0 },
        cleanup: cleanupSummary,
      };
    }

    logger.info({ count: jobsToRun.length }, 'Picked queued jobs for execution');

    // 2. Process each locked job
    for (const job of jobsToRun) {
      try {
        switch (job.kind) {
          case 'PROCESS_IMAGE':
            await handleProcessImage(job.payload as ProcessImagePayload);
            break;
          case 'COMPUTE_MATCHES':
            await handleComputeMatches(job.payload as ComputeMatchesPayload);
            break;
          case 'PURGE_STORAGE_OBJECT':
            await handlePurgeStorageObject(job.payload as PurgeStoragePayload);
            break;
          default:
            logger.warn({ kind: job.kind, jobId: job.id }, 'Unknown job kind encountered');
        }

        // Mark completed
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'DONE',
            lockedAt: null,
          },
        });
        processedCount++;
      } catch (err) {
        errorCount++;
        const safeInfo = sanitizeLogErr(err);
        const errorCode = (safeInfo.errorCode ? String(safeInfo.errorCode) : safeInfo.errorName).slice(0, 255);
        logger.error({ jobId: job.id, kind: job.kind, ...safeInfo }, 'Job execution failed');

        const nextAttempts = job.attempts + 1;
        if (nextAttempts >= job.max_attempts) {
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              lastErrorCode: errorCode,
              lockedAt: null,
            },
          });
        } else {
          // Exponential backoff
          const delaySeconds = Math.min(60 * Math.pow(2, job.attempts), 3600);
          await prisma.$executeRaw`
            UPDATE jobs
            SET status = 'QUEUED',
                available_at = now() + (${delaySeconds} || ' seconds')::interval,
                last_error_code = ${errorCode},
                locked_at = null
            WHERE id = ${job.id}::uuid;
          `;
        }
      }
    }

    return {
      processed: processedCount,
      errors: errorCount,
      jobs: { processed: processedCount, errors: errorCount },
      cleanup: cleanupSummary,
    };
  }
}

export const jobRunner = new JobRunner();
