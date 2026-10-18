import prisma from '@/src/db';
import logger from '@/src/lib/logger';
import { handleProcessImage, handleComputeMatches, ProcessImagePayload, ComputeMatchesPayload } from './handlers';

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
   * Returns the count of jobs successfully processed.
   */
  async tick(batchSize = 10): Promise<{ processed: number; errors: number }> {
    let processedCount = 0;
    let errorCount = 0;

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
      return { processed: 0, errors: 0 };
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
        const errorMessage = (err as Error).message || 'Unknown error';
        logger.error({ jobId: job.id, kind: job.kind, err }, 'Job execution failed');

        const nextAttempts = job.attempts + 1;
        if (nextAttempts >= job.max_attempts) {
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              lastErrorCode: errorMessage.slice(0, 255),
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
                last_error_code = ${errorMessage.slice(0, 255)},
                locked_at = null
            WHERE id = ${job.id}::uuid;
          `;
        }
      }
    }

    return { processed: processedCount, errors: errorCount };
  }
}

export const jobRunner = new JobRunner();
