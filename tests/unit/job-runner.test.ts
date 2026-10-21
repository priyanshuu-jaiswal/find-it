import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/src/db';
import { uploadsService } from '@/src/modules/uploads/service';
import { JobRunner } from '@/src/jobs/runner';

vi.mock('@/src/db', () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    job: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@/src/modules/uploads/service', () => ({
  uploadsService: {
    cleanupAbandonedUploads: vi.fn(),
  },
}));

vi.mock('@/src/jobs/handlers', () => ({
  handleProcessImage: vi.fn(),
  handleComputeMatches: vi.fn(),
  handlePurgeStorageObject: vi.fn(),
}));

describe('JobRunner & Cleanup Failure Reporting Hardening', () => {
  let runner: JobRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new JobRunner();

    // Default: transaction returns no locked jobs
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return cb(tx);
    });
  });

  describe('1. Top-Level Cleanup Sweep Failure Protection', () => {
    it('catches thrown exception, returns stable CLEANUP_SWEEP_FAILED code, and never discloses sensitive error text', async () => {
      const sensitiveLeakString = 'postgresql://findit_admin:p@ssw0rd123@ep-cool-db.us-east-1.aws.neon.tech/findit?sslmode=require';
      const sensitiveRawKey = 'raw/secret-org/confidential-user-document.pdf';

      vi.mocked(uploadsService.cleanupAbandonedUploads).mockRejectedValueOnce(
        new Error(`Fatal DB connection dropped for ${sensitiveLeakString} while reading ${sensitiveRawKey}`)
      );

      const result = await runner.tick(10);

      // Distinct semantics: top-level failure marks success false and metrics unavailable
      expect(result.cleanup.success).toBe(false);
      expect(result.cleanup.metricsAvailable).toBe(false);
      expect(result.cleanup.totalBacklog).toBeNull();
      expect(result.cleanup.cleanedCount).toBe(0);
      expect(result.cleanup.failedCount).toBe(0);
      expect(result.cleanup.error).toBe('CLEANUP_SWEEP_FAILED');

      // Crucial: The result object returned to the API layer must NEVER contain the raw exception text or secrets
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(sensitiveLeakString);
      expect(serialized).not.toContain('p@ssw0rd123');
      expect(serialized).not.toContain(sensitiveRawKey);
      expect(serialized).not.toContain('neon.tech');
      expect(serialized).not.toContain('stack');
    });
  });

  describe('2. Per-Object Failure Reporting & Semantics', () => {
    it('sets STORAGE_DELETION_FAILED and success: false when sweep finishes but has individual failures', async () => {
      vi.mocked(uploadsService.cleanupAbandonedUploads).mockResolvedValueOnce({
        cleanedCount: 4,
        failedCount: 2,
        processedInBatch: 6,
        metricsAvailable: true,
        totalBacklog: 12,
        failedAttemptsCount: 2,
        oldestPendingAgeSeconds: 3600,
      });

      const result = await runner.tick(10);

      // Distinct semantics: sweep completed, metrics are available, but individual storage deletions failed
      expect(result.cleanup.success).toBe(false);
      expect(result.cleanup.cleanedCount).toBe(4);
      expect(result.cleanup.failedCount).toBe(2);
      expect(result.cleanup.processedInBatch).toBe(6);
      expect(result.cleanup.metricsAvailable).toBe(true);
      expect(result.cleanup.totalBacklog).toBe(12);
      expect(result.cleanup.error).toBe('STORAGE_DELETION_FAILED');

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('stack');
      expect(serialized).not.toContain('NoSuchKey');
    });

    it('sets success: true and error: undefined when sweep finishes with zero failures', async () => {
      vi.mocked(uploadsService.cleanupAbandonedUploads).mockResolvedValueOnce({
        cleanedCount: 5,
        failedCount: 0,
        processedInBatch: 5,
        metricsAvailable: true,
        totalBacklog: 0,
        failedAttemptsCount: 0,
        oldestPendingAgeSeconds: null,
      });

      const result = await runner.tick(10);

      expect(result.cleanup.success).toBe(true);
      expect(result.cleanup.cleanedCount).toBe(5);
      expect(result.cleanup.failedCount).toBe(0);
      expect(result.cleanup.metricsAvailable).toBe(true);
      expect(result.cleanup.totalBacklog).toBe(0);
      expect(result.cleanup.error).toBeUndefined();
    });
  });

  describe('3. Job Execution Error Sanitization', () => {
    it('sanitizes lastErrorCode without leaking sensitive database URL or stack details', async () => {
      const sensitiveLeak = 'https://s3.amazonaws.com/findit-private/raw/secret-user.jpg?X-Amz-Signature=abc123secret';

      vi.mocked(uploadsService.cleanupAbandonedUploads).mockResolvedValueOnce({
        cleanedCount: 0,
        failedCount: 0,
        processedInBatch: 0,
        metricsAvailable: true,
        totalBacklog: 0,
        failedAttemptsCount: 0,
        oldestPendingAgeSeconds: null,
      });

      // Transaction returns 1 queued job that will fail
      const jobRow = {
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'PROCESS_IMAGE',
        payload: { imageId: 'img-1' },
        attempts: 2,
        max_attempts: 3,
      };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([jobRow]),
          $executeRaw: vi.fn().mockResolvedValue(1),
        };
        return cb(tx);
      });

      const { handleProcessImage } = await import('@/src/jobs/handlers');
      const s3Error = new Error(`Request to ${sensitiveLeak} failed`);
      s3Error.name = 'NoSuchKey';
      vi.mocked(handleProcessImage).mockRejectedValueOnce(s3Error);

      const result = await runner.tick(10);

      expect(result.jobs.errors).toBe(1);
      expect(result.jobs.processed).toBe(0);

      // Verify prisma.job.update was called with sanitized lastErrorCode
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: jobRow.id },
        data: expect.objectContaining({
          status: 'FAILED',
          lastErrorCode: 'NoSuchKey',
        }),
      });

      // Assert sensitive URL with secret signature was NOT passed into lastErrorCode
      const updateCall = vi.mocked(prisma.job.update).mock.calls[0][0];
      expect(updateCall.data.lastErrorCode).not.toContain(sensitiveLeak);
      expect(updateCall.data.lastErrorCode).not.toContain('X-Amz-Signature');
    });
  });
});
