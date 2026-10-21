import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/v1/internal/worker/tick/route';
import { jobRunner, WorkerTickResult } from '@/src/jobs/runner';
import { env } from '@/src/lib/env';

vi.mock('@/src/jobs/runner', () => ({
  jobRunner: {
    tick: vi.fn(),
  },
}));

const mockTickResult = (processed: number, errors = 0): WorkerTickResult => ({
  processed,
  errors,
  jobs: { processed, errors },
  cleanup: {
    success: true,
    cleanedCount: 0,
    failedCount: 0,
    processedInBatch: 0,
    metricsAvailable: true,
    totalBacklog: 0,
    failedAttemptsCount: 0,
    oldestPendingAgeSeconds: null,
  },
});

describe('Worker Tick & Cron Security & Durability', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'mock-cron-secret-abcdef';
  });

  describe('Worker Authentication Guard', () => {
    it('rejects requests with missing Authorization header', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick');
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN');
      expect(jobRunner.tick).not.toHaveBeenCalled();
    });

    it('rejects requests with invalid worker token', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: 'Bearer invalid-secret-token' },
      });
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN');
      expect(jobRunner.tick).not.toHaveBeenCalled();
    });

    it('accepts requests with valid WORKER_SECRET', async () => {
      vi.mocked(jobRunner.tick).mockResolvedValueOnce(mockTickResult(3, 0));

      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual(mockTickResult(3, 0));
      expect(jobRunner.tick).toHaveBeenCalledWith(10);
    });

    it('accepts requests with valid CRON_SECRET (Vercel Cron automatic header)', async () => {
      vi.mocked(jobRunner.tick).mockResolvedValueOnce(mockTickResult(5, 0));

      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: 'Bearer mock-cron-secret-abcdef' },
      });
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual(mockTickResult(5, 0));
      expect(jobRunner.tick).toHaveBeenCalledWith(10);
    });
  });

  describe('Worker POST Invocation & Batch Sizing', () => {
    it('accepts POST with custom batchSize', async () => {
      vi.mocked(jobRunner.tick).mockResolvedValueOnce(mockTickResult(25, 0));

      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.WORKER_SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ batchSize: 25 }),
      });
      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual(mockTickResult(25, 0));
      expect(jobRunner.tick).toHaveBeenCalledWith(25);
    });
  });

  describe('Durable Job Recovery Assumptions', () => {
    it('ensures tick failures do not lose jobs, allowing recovery on subsequent ticks', async () => {
      // Simulate tick 1 failure (e.g. transient timeout or DB hiccup)
      vi.mocked(jobRunner.tick).mockRejectedValueOnce(new Error('Transient database timeout'));

      const req1 = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const res1 = await GET(req1);
      expect(res1.status).toBe(500);

      // On tick 2 (subsequent invocation), runner executes cleanly and re-locks pending jobs
      vi.mocked(jobRunner.tick).mockResolvedValueOnce(mockTickResult(4, 0));

      const req2 = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const res2 = await GET(req2);
      const json2 = await res2.json();

      expect(res2.status).toBe(200);
      expect(json2.data).toEqual(mockTickResult(4, 0));
      expect(jobRunner.tick).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cleanup Sweep Observability in Worker Response', () => {
    it('exposes cleanup failure in worker response with sanitized error code when job processing succeeds completely', async () => {
      // Simulate jobs succeeding (3 processed, 0 errors) but cleanup sweep encountering individual storage failures
      vi.mocked(jobRunner.tick).mockResolvedValueOnce({
        processed: 3,
        errors: 0,
        jobs: { processed: 3, errors: 0 },
        cleanup: {
          success: false,
          cleanedCount: 0,
          failedCount: 2,
          processedInBatch: 2,
          metricsAvailable: true,
          totalBacklog: 5,
          failedAttemptsCount: 2,
          oldestPendingAgeSeconds: 1200,
          error: 'STORAGE_DELETION_FAILED',
        },
      });

      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.jobs).toEqual({ processed: 3, errors: 0 });
      // Crucial: cleanup failure is not hidden or masked by jobs succeeding
      expect(json.data.cleanup.success).toBe(false);
      expect(json.data.cleanup.failedCount).toBe(2);
      expect(json.data.cleanup.error).toBe('STORAGE_DELETION_FAILED');
      expect(json.data.cleanup.totalBacklog).toBe(5);

      // Verify no raw exception messages or credentials leak in response
      const responseStr = JSON.stringify(json);
      expect(responseStr).not.toContain('S3 503');
      expect(responseStr).not.toContain('stack');
      expect(responseStr).not.toContain('raw/');
    });

    it('returns sanitized error code and hides raw exception details when sweep fails top-level', async () => {
      // Simulate top-level sweep failure (e.g. database timeout or connection drop during sweep query)
      vi.mocked(jobRunner.tick).mockResolvedValueOnce({
        processed: 0,
        errors: 0,
        jobs: { processed: 0, errors: 0 },
        cleanup: {
          success: false,
          cleanedCount: 0,
          failedCount: 0,
          processedInBatch: 0,
          metricsAvailable: false,
          totalBacklog: null,
          failedAttemptsCount: null,
          oldestPendingAgeSeconds: null,
          error: 'CLEANUP_SWEEP_FAILED',
        },
      });

      const req = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.cleanup.success).toBe(false);
      expect(json.data.cleanup.metricsAvailable).toBe(false);
      expect(json.data.cleanup.error).toBe('CLEANUP_SWEEP_FAILED');

      const responseStr = JSON.stringify(json);
      expect(responseStr).not.toContain('PrismaClientInitializationError');
      expect(responseStr).not.toContain('postgresql://');
      expect(responseStr).not.toContain('stack');
    });
  });
});
