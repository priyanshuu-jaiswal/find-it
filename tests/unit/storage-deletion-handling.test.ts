import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/src/db';
import { StorageAdapter } from '@/src/modules/uploads/storage-adapter';
import { handlePurgeStorageObject, handleProcessImage } from '@/src/jobs/handlers';
import {
  uploadsService,
  buildOutstandingCleanupWhere,
  buildEligibleCleanupWhere,
} from '@/src/modules/uploads/service';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { imageProcessor } from '@/src/modules/uploads/image-processor';
import * as validationModule from '@/src/modules/uploads/validation';

vi.mock('@/src/db', () => ({
  default: {
    reportImage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    job: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/src/modules/uploads/image-processor', () => ({
  imageProcessor: {
    processToThumbnail: vi.fn(),
  },
}));

describe('Storage Deletion Reliability & Durable Retry Behavior', () => {
  const dummyOrgId = 'org-1111';
  const dummyImageId = 'img-2222';
  const dummyRawKey = `raw/${dummyOrgId}/${dummyImageId}.jpg`;
  const dummyThumbKey = `thumb/${dummyOrgId}/${dummyImageId}.webp`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.reportImage.update).mockResolvedValue({} as any);
    vi.mocked(prisma.reportImage.delete).mockResolvedValue({} as any);
    vi.mocked(prisma.job.create).mockResolvedValue({} as any);
  });

  describe('1. StorageAdapter.deleteObject failure propagation & idempotency', () => {
    it('surfaces transient provider errors (e.g. 503) without swallowing them', async () => {
      const adapter = new StorageAdapter();
      const mockSend = vi.fn().mockRejectedValue(new Error('S3 503 Service Unavailable'));
      (adapter as any).isConfigured = true;
      (adapter as any).client = { send: mockSend };

      await expect(adapter.deleteObject(dummyRawKey)).rejects.toThrow(
        'S3 503 Service Unavailable'
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('treats confirmed already-missing objects (NoSuchKey/NotFound/404) as idempotent success', async () => {
      const adapter = new StorageAdapter();
      const noSuchKeyErr: any = new Error('The specified key does not exist.');
      noSuchKeyErr.name = 'NoSuchKey';
      const mockSend = vi.fn().mockRejectedValue(noSuchKeyErr);
      (adapter as any).isConfigured = true;
      (adapter as any).client = { send: mockSend };

      // Must resolve without throwing
      await expect(adapter.deleteObject(dummyRawKey)).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('treats 404 httpStatusCode metadata as idempotent success', async () => {
      const adapter = new StorageAdapter();
      const notFoundErr: any = new Error('Not Found');
      notFoundErr.$metadata = { httpStatusCode: 404 };
      const mockSend = vi.fn().mockRejectedValue(notFoundErr);
      (adapter as any).isConfigured = true;
      (adapter as any).client = { send: mockSend };

      await expect(adapter.deleteObject(dummyRawKey)).resolves.toBeUndefined();
    });

    it('throws when storage is unconfigured when deleting a remote object', async () => {
      const adapter = new StorageAdapter();
      (adapter as any).isConfigured = false;
      (adapter as any).client = null;

      await expect(adapter.deleteObject(dummyRawKey)).rejects.toThrow(
        /External storage is not configured/
      );
    });

    it('throws when objectKey is empty', async () => {
      const adapter = new StorageAdapter();
      (adapter as any).isConfigured = true;
      (adapter as any).client = { send: vi.fn() };

      await expect(adapter.deleteObject('')).rejects.toThrow(/objectKey is required/);
    });
  });

  describe('2. handlePurgeStorageObject durable retry handler', () => {
    it('throws on transient deletion failure so job runner retries, and does not mark object purged', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.spyOn(storageAdapter, 'deleteObject').mockRejectedValueOnce(
        new Error('S3 500 Internal Error')
      );

      await expect(
        handlePurgeStorageObject({ objectKey: dummyRawKey, imageId: dummyImageId })
      ).rejects.toThrow('S3 500 Internal Error');

      // Database row must NOT be marked purged
      expect(prisma.reportImage.update).not.toHaveBeenCalled();
    });

    it('throws when storage is unconfigured so job runner retries later, preserving row state', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(false);
      const deleteSpy = vi.spyOn(storageAdapter, 'deleteObject');

      await expect(
        handlePurgeStorageObject({ objectKey: dummyRawKey, imageId: dummyImageId })
      ).rejects.toThrow(/Storage is unconfigured/);

      expect(deleteSpy).not.toHaveBeenCalled();
      expect(prisma.reportImage.update).not.toHaveBeenCalled();
    });

    it('marks object purged in database upon successful storage deletion', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      await handlePurgeStorageObject({ objectKey: dummyRawKey, imageId: dummyImageId });

      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(dummyRawKey);
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: {
          rawObjectKey: `purged:${dummyImageId}`,
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });
    });

    it('handles already-missing object idempotently and updates DB', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      // deleteObject resolves cleanly when object is absent (idempotent contract)
      vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      await handlePurgeStorageObject({ objectKey: dummyRawKey, imageId: dummyImageId });

      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: {
          rawObjectKey: `purged:${dummyImageId}`,
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });
    });

    it('resolves cleanly if DB record was already deleted (P2025)', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      const p2025Err: any = new Error('Record to update not found');
      p2025Err.code = 'P2025';
      vi.mocked(prisma.reportImage.update).mockRejectedValueOnce(p2025Err);

      await expect(
        handlePurgeStorageObject({ objectKey: dummyRawKey, imageId: dummyImageId })
      ).resolves.toBeUndefined();
    });
  });

  describe('3. handleProcessImage raw object purge & failure durability', () => {
    it('retains rawObjectKey in DB and enqueues durable PURGE_STORAGE_OBJECT job when delete fails', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        organizationId: dummyOrgId,
        rawObjectKey: dummyRawKey,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
      } as any);

      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        contentLength: 1024,
        contentType: 'image/jpeg',
      });
      vi.spyOn(storageAdapter, 'getObjectBuffer').mockResolvedValue(Buffer.from('fake-jpeg'));
      vi.spyOn(validationModule, 'detectImageSignature').mockReturnValue('image/jpeg');
      vi.mocked(imageProcessor.processToThumbnail).mockResolvedValue({
        buffer: Buffer.from('fake-webp'),
        width: 300,
        height: 200,
        format: 'webp',
      });
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue();

      // Deleting raw object fails
      vi.spyOn(storageAdapter, 'deleteObject').mockRejectedValueOnce(
        new Error('S3 503 Service Unavailable')
      );

      await handleProcessImage({ imageId: dummyImageId });

      // Image status set to READY
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: {
          status: 'READY',
          thumbObjectKey: `thumb/${dummyOrgId}/${dummyImageId}.webp`,
          width: 300,
          height: 200,
        },
      });

      // Crucial: Must NOT update rawObjectKey to purged: in DB when delete failed!
      expect(prisma.reportImage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rawObjectKey: `purged:${dummyImageId}` }),
        })
      );

      // Must enqueue durable retry job with actual raw key
      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          kind: 'PURGE_STORAGE_OBJECT',
          dedupeKey: `purge_storage:${dummyRawKey}`,
          payload: { objectKey: dummyRawKey, imageId: dummyImageId },
          status: 'QUEUED',
        },
      });
    });

    it('makes failure to enqueue purge job visible and retryable by throwing', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        organizationId: dummyOrgId,
        rawObjectKey: dummyRawKey,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
      } as any);

      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        contentLength: 1024,
        contentType: 'image/jpeg',
      });
      vi.spyOn(storageAdapter, 'getObjectBuffer').mockResolvedValue(Buffer.from('fake-jpeg'));
      vi.spyOn(validationModule, 'detectImageSignature').mockReturnValue('image/jpeg');
      vi.mocked(imageProcessor.processToThumbnail).mockResolvedValue({
        buffer: Buffer.from('fake-webp'),
        width: 300,
        height: 200,
        format: 'webp',
      });
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue();

      // Deleting raw object fails
      vi.spyOn(storageAdapter, 'deleteObject').mockRejectedValueOnce(
        new Error('S3 503 Service Unavailable')
      );

      // Enqueuing job also fails (e.g. database connection lost)
      vi.mocked(prisma.job.create).mockRejectedValueOnce(
        new Error('DB Connection Refused')
      );

      await expect(handleProcessImage({ imageId: dummyImageId })).rejects.toThrow(
        'DB Connection Refused'
      );
    });

    it('purges raw object and updates rawObjectKey to purged: upon successful deletion', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        organizationId: dummyOrgId,
        rawObjectKey: dummyRawKey,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
      } as any);

      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        contentLength: 1024,
        contentType: 'image/jpeg',
      });
      vi.spyOn(storageAdapter, 'getObjectBuffer').mockResolvedValue(Buffer.from('fake-jpeg'));
      vi.spyOn(validationModule, 'detectImageSignature').mockReturnValue('image/jpeg');
      vi.mocked(imageProcessor.processToThumbnail).mockResolvedValue({
        buffer: Buffer.from('fake-webp'),
        width: 300,
        height: 200,
        format: 'webp',
      });
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue();
      vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      await handleProcessImage({ imageId: dummyImageId });

      // Raw object key successfully updated to purged:
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: {
          rawObjectKey: `purged:${dummyImageId}`,
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });
      // No purge job needed
      expect(prisma.job.create).not.toHaveBeenCalled();
    });
  });

  describe('4. cleanupAbandonedUploads failure retention & retry behavior', () => {
    it('retains DB record and keys when storage is temporarily unconfigured', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(false);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: dummyImageId,
          rawObjectKey: dummyRawKey,
          thumbObjectKey: dummyThumbKey,
          status: 'PENDING_UPLOAD',
          reportId: null,
        } as any,
      ]);

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(0);
      // Row must NOT be deleted
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
      // Must not overwrite keys; marks REJECTED and schedules retry with backoff
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: {
          status: 'REJECTED',
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
        },
      });
    });

    it('retains DB record when thumbnail deletion fails even if raw deletion succeeded', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: dummyImageId,
          rawObjectKey: dummyRawKey,
          thumbObjectKey: dummyThumbKey,
          status: 'REJECTED',
          reportId: null,
        } as any,
      ]);

      // Raw succeeds, thumb fails
      vi.spyOn(storageAdapter, 'deleteObject')
        .mockResolvedValueOnce() // raw deleted
        .mockRejectedValueOnce(new Error('S3 503 for thumb')); // thumb failed

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(0);
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });

    it('succeeds on a later retry sweep after earlier provider failure', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: dummyImageId,
          rawObjectKey: dummyRawKey,
          thumbObjectKey: dummyThumbKey,
          status: 'REJECTED',
          reportId: null,
        } as any,
      ]);

      // Both deletions succeed on later retry
      vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValue();

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(1);
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(dummyRawKey);
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(dummyThumbKey);
      expect(prisma.reportImage.delete).toHaveBeenCalledWith({
        where: { id: dummyImageId },
      });
    });

    it('READY sweep leaves rawObjectKey intact and schedules backoff if storage is unconfigured', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(false);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: dummyImageId,
          rawObjectKey: dummyRawKey,
          thumbObjectKey: dummyThumbKey,
          status: 'READY',
          reportId: 'rep-1',
        } as any,
      ]);

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(0);
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: {
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
        },
      });
      expect(prisma.reportImage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rawObjectKey: `purged:${dummyImageId}` }),
        })
      );
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });
  });

  describe('5. Attached rejected image lifecycle, error propagation & report preservation', () => {
    const attachedReportId = 'rep-attached-9999';
    const attachedRejectedImageId = 'img-attached-8888';
    const attachedRawKey = `raw/${dummyOrgId}/${attachedRejectedImageId}.jpg`;

    it('propagates failure when raw deletion fails and purge-job creation fails for an attached rejected image', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: attachedRejectedImageId,
        organizationId: dummyOrgId,
        reportId: attachedReportId, // Attached to a report!
        rawObjectKey: attachedRawKey,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
      } as any);

      // Validation fails: oversized object in storage
      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        contentLength: 20 * 1024 * 1024, // 20 MB > 10 MB limit
        contentType: 'image/jpeg',
      });

      // Storage delete fails (e.g. S3 503)
      vi.spyOn(storageAdapter, 'deleteObject').mockRejectedValueOnce(
        new Error('S3 503 Service Unavailable')
      );

      // Purge-job queue creation also fails (e.g. transient DB connection error)
      vi.mocked(prisma.job.create).mockRejectedValueOnce(
        new Error('DB Connection Refused during enqueue')
      );

      // Must propagate the enqueue error so job runner retries rather than marking complete
      await expect(
        handleProcessImage({ imageId: attachedRejectedImageId })
      ).rejects.toThrow('DB Connection Refused during enqueue');

      // Status was updated to REJECTED in database
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: attachedRejectedImageId },
        data: { status: 'REJECTED' },
      });

      // Must NOT have marked rawObjectKey as purged
      expect(prisma.reportImage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rawObjectKey: `purged:${attachedRejectedImageId}` }),
        })
      );

      // Must NOT delete the image row (preserves report integrity)
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });

    it('retries raw-object deletion without reprocessing the image when handleProcessImage retries a REJECTED image', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      // Image is already marked REJECTED from previous attempt
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: attachedRejectedImageId,
        organizationId: dummyOrgId,
        reportId: attachedReportId,
        rawObjectKey: attachedRawKey,
        status: 'REJECTED',
        contentType: 'image/jpeg',
      } as any);

      const getBufferSpy = vi.spyOn(storageAdapter, 'getObjectBuffer');
      const processThumbnailSpy = vi.mocked(imageProcessor.processToThumbnail);
      const deleteObjectSpy = vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      // Retry executes
      await handleProcessImage({ imageId: attachedRejectedImageId });

      // Must NOT reprocess image as a valid upload
      expect(getBufferSpy).not.toHaveBeenCalled();
      expect(processThumbnailSpy).not.toHaveBeenCalled();

      // Must retry raw-object deletion
      expect(deleteObjectSpy).toHaveBeenCalledWith(attachedRawKey);

      // Must update rawObjectKey to purged
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: attachedRejectedImageId },
        data: {
          rawObjectKey: `purged:${attachedRejectedImageId}`,
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });

      // Report integrity: database row must NOT be deleted
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });

    it('worker sweep cleans up attached rejected image: purges raw S3 object and preserves report image row', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: attachedRejectedImageId,
          rawObjectKey: attachedRawKey,
          thumbObjectKey: null,
          status: 'REJECTED',
          reportId: attachedReportId, // Attached to report!
        } as any,
      ]);

      const deleteObjectSpy = vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(1);
      // S3 raw object deleted
      expect(deleteObjectSpy).toHaveBeenCalledWith(attachedRawKey);

      // Database rawObjectKey updated to purged and retry counters reset
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: attachedRejectedImageId },
        data: {
          rawObjectKey: `purged:${attachedRejectedImageId}`,
        },
      });
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: attachedRejectedImageId },
        data: {
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });

      // CRITICAL: Database row must NOT be deleted to preserve report integrity
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });

    it('worker sweep retains key and row when S3 delete fails for attached rejected image', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: attachedRejectedImageId,
          rawObjectKey: attachedRawKey,
          thumbObjectKey: null,
          status: 'REJECTED',
          reportId: attachedReportId,
        } as any,
      ]);

      vi.spyOn(storageAdapter, 'deleteObject').mockRejectedValueOnce(
        new Error('S3 503 Service Unavailable')
      );

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(0);
      // Schedules retry with backoff, does not mark purged
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: attachedRejectedImageId },
        data: {
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
        },
      });
      expect(prisma.reportImage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rawObjectKey: `purged:${attachedRejectedImageId}` }),
        })
      );
      // Must not delete row
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });

    it('handles partial storage deletion for attached rejected image: raw succeeds, thumb fails, retry purges remaining thumb without duplicating work', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      const partialRejectedImageId = 'attached-partial-rejected-id';
      const rawKey = `raw/${dummyOrgId}/${partialRejectedImageId}.jpg`;
      const thumbKey = `thumb/${dummyOrgId}/${partialRejectedImageId}.webp`;

      // Tick 1: Both raw and thumb keys are unpurged
      vi.mocked(prisma.reportImage.findMany).mockResolvedValueOnce([
        {
          id: partialRejectedImageId,
          rawObjectKey: rawKey,
          thumbObjectKey: thumbKey,
          status: 'REJECTED',
          reportId: attachedReportId,
          cleanupAttempts: 0,
          nextRetryAt: null,
        } as any,
      ]);

      // Storage: Raw succeeds, thumb fails
      const deleteObjectSpy = vi.spyOn(storageAdapter, 'deleteObject')
        .mockResolvedValueOnce() // raw deleted
        .mockRejectedValueOnce(new Error('S3 503 Service Unavailable for thumb'));

      const tick1Res = await uploadsService.cleanupAbandonedUploads(15);
      expect(tick1Res.cleanedCount).toBe(0);
      expect(tick1Res.failedCount).toBe(1);

      // Verify raw was purged in storage and database updated rawObjectKey: purged:${id}
      expect(deleteObjectSpy).toHaveBeenCalledWith(rawKey);
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: partialRejectedImageId },
        data: { rawObjectKey: `purged:${partialRejectedImageId}` },
      });
      // Backoff scheduled
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: partialRejectedImageId },
        data: {
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
        },
      });
      // Database row must NOT be deleted
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();

      // Tick 2: On subsequent sweep after backoff, the query selects this image
      // (because thumbObjectKey still starts with 'thumb/').
      // rawObjectKey is now 'purged:...', so raw deletion is skipped!
      deleteObjectSpy.mockClear();
      vi.mocked(prisma.reportImage.update).mockClear();

      vi.mocked(prisma.reportImage.findMany).mockResolvedValueOnce([
        {
          id: partialRejectedImageId,
          rawObjectKey: `purged:${partialRejectedImageId}`,
          thumbObjectKey: thumbKey,
          status: 'REJECTED',
          reportId: attachedReportId,
          cleanupAttempts: 1,
          nextRetryAt: new Date(Date.now() - 1000),
        } as any,
      ]);

      // Thumb deletion now succeeds!
      deleteObjectSpy.mockResolvedValueOnce();

      const tick2Res = await uploadsService.cleanupAbandonedUploads(15);
      expect(tick2Res.cleanedCount).toBe(1);
      expect(tick2Res.failedCount).toBe(0);

      // Raw delete was NOT called again
      expect(deleteObjectSpy).not.toHaveBeenCalledWith(rawKey);
      // Thumb delete was called
      expect(deleteObjectSpy).toHaveBeenCalledWith(thumbKey);

      // Database thumbObjectKey updated to purged and retry counters reset
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: partialRejectedImageId },
        data: { thumbObjectKey: `purged:${partialRejectedImageId}` },
      });
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: partialRejectedImageId },
        data: {
          rawObjectKey: undefined,
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });

      // Report row must NEVER be deleted
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });
  });

  describe('6. Fair sweeper pagination, multi-batch scheduling & backlog metrics', () => {
    const item1 = {
      id: 'batch1-img1',
      rawObjectKey: `raw/${dummyOrgId}/batch1-img1.jpg`,
      thumbObjectKey: null,
      status: 'REJECTED' as const,
      reportId: null,
      cleanupAttempts: 0,
      nextRetryAt: null,
      createdAt: new Date('2026-10-21T10:00:00Z'),
    };

    const item2 = {
      id: 'batch1-img2',
      rawObjectKey: `raw/${dummyOrgId}/batch1-img2.jpg`,
      thumbObjectKey: null,
      status: 'REJECTED' as const,
      reportId: null,
      cleanupAttempts: 0,
      nextRetryAt: null,
      createdAt: new Date('2026-10-21T10:01:00Z'),
    };

    const item3 = {
      id: 'batch2-img3',
      rawObjectKey: `raw/${dummyOrgId}/batch2-img3.jpg`,
      thumbObjectKey: null,
      status: 'REJECTED' as const,
      reportId: null,
      cleanupAttempts: 0,
      nextRetryAt: null,
      createdAt: new Date('2026-10-21T10:02:00Z'),
    };

    const item4 = {
      id: 'batch2-img4',
      rawObjectKey: `raw/${dummyOrgId}/batch2-img4.jpg`,
      thumbObjectKey: null,
      status: 'REJECTED' as const,
      reportId: null,
      cleanupAttempts: 0,
      nextRetryAt: null,
      createdAt: new Date('2026-10-21T10:03:00Z'),
    };

    it('gives later batches a chance when initial batch suffers persistent storage failures', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);

      // Tick 1: findMany returns Batch 1 (item1 & item2)
      vi.mocked(prisma.reportImage.findMany).mockResolvedValueOnce([item1, item2] as any);

      // Storage delete fails for Batch 1 (e.g. S3 503)
      vi.spyOn(storageAdapter, 'deleteObject')
        .mockRejectedValueOnce(new Error('S3 503 for item1'))
        .mockRejectedValueOnce(new Error('S3 503 for item2'));

      const tick1Res = await uploadsService.cleanupAbandonedUploads({ batchSize: 2 });
      expect(tick1Res.cleanedCount).toBe(0);

      // Batch 1 items received backoff retry scheduling
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: item1.id },
        data: expect.objectContaining({
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
        }),
      });
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: item2.id },
        data: expect.objectContaining({
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
        }),
      });

      // Tick 2: Because Batch 1 items now have nextRetryAt in the future,
      // the query selects eligible Batch 2 items (item3 & item4)
      vi.mocked(prisma.reportImage.findMany).mockResolvedValueOnce([item3, item4] as any);

      // Storage succeeds for Batch 2 items
      vi.spyOn(storageAdapter, 'deleteObject')
        .mockResolvedValueOnce()
        .mockResolvedValueOnce();

      const tick2Res = await uploadsService.cleanupAbandonedUploads({ batchSize: 2 });
      expect(tick2Res.cleanedCount).toBe(2);

      // Proves Batch 2 was processed and NOT starved by Batch 1's persistent failures!
      expect(prisma.reportImage.delete).toHaveBeenCalledWith({ where: { id: item3.id } });
      expect(prisma.reportImage.delete).toHaveBeenCalledWith({ where: { id: item4.id } });
    });

    it('retries and eventually cleans up failing records after storage recovers', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);

      // After backoff delay expires, item1 and item2 become eligible again
      const retryingItem1 = {
        ...item1,
        cleanupAttempts: 1,
        nextRetryAt: new Date(Date.now() - 1000), // Retry time has arrived
      };

      vi.mocked(prisma.reportImage.findMany).mockResolvedValueOnce([retryingItem1] as any);

      // Storage has now recovered!
      vi.spyOn(storageAdapter, 'deleteObject').mockResolvedValueOnce();

      const res = await uploadsService.cleanupAbandonedUploads({ batchSize: 1 });
      expect(res.cleanedCount).toBe(1);

      // Successfully purged after storage recovery
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(item1.rawObjectKey);
      expect(prisma.reportImage.delete).toHaveBeenCalledWith({ where: { id: item1.id } });
    });

    it('collects and reports safe backlog metrics without leaking sensitive information', async () => {
      (prisma.reportImage as any).count = vi
        .fn()
        .mockResolvedValueOnce(42) // totalBacklog
        .mockResolvedValueOnce(5); // failedAttemptsCount

      (prisma.reportImage as any).findFirst = vi.fn().mockResolvedValueOnce({
        createdAt: new Date(Date.now() - 7200 * 1000), // 2 hours ago
      });

      const metrics = await uploadsService.getCleanupMetrics(15);

      expect(metrics.totalBacklog).toBe(42);
      expect(metrics.failedAttemptsCount).toBe(5);
      expect(metrics.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(7190);
      expect(metrics.oldestPendingAgeSeconds).toBeLessThanOrEqual(7210);
      expect(metrics.metricsAvailable).toBe(true);

      // Assert metrics object does not expose URLs, secrets, or object keys
      const metricKeys = Object.keys(metrics);
      expect(metricKeys).toEqual(['totalBacklog', 'failedAttemptsCount', 'oldestPendingAgeSeconds', 'metricsAvailable']);
    });

    it('returns metricsAvailable: false and null counts when database metric queries fail', async () => {
      (prisma.reportImage as any).count = vi.fn().mockRejectedValueOnce(new Error('DB connection dropped'));

      const metrics = await uploadsService.getCleanupMetrics(15);
      expect(metrics.metricsAvailable).toBe(false);
      expect(metrics.totalBacklog).toBeNull();
      expect(metrics.failedAttemptsCount).toBeNull();
      expect(metrics.oldestPendingAgeSeconds).toBeNull();
    });

    it('cleanupAbandonedUploads safely reports metricsAvailable: false if metrics collection fails after sweep', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);
      vi.mocked(prisma.reportImage.findMany).mockResolvedValueOnce([]);
      (prisma.reportImage as any).count = vi.fn().mockRejectedValueOnce(new Error('Metrics query timeout'));

      const sweep = await uploadsService.cleanupAbandonedUploads();
      expect(sweep.cleanedCount).toBe(0);
      expect(sweep.failedCount).toBe(0);
      expect(sweep.metricsAvailable).toBe(false);
      expect(sweep.totalBacklog).toBeNull();
    });

    it('separates backlog metrics predicate (includes backoff) from processing eligibility predicate (excludes backoff)', () => {
      const now = new Date('2026-10-22T12:00:00Z');
      const outstandingWhere = buildOutstandingCleanupWhere(now, 15);
      const eligibleWhere = buildEligibleCleanupWhere(now, 15);

      // Outstanding predicate must NOT restrict nextRetryAt (counts all outstanding work)
      expect((outstandingWhere as any).AND).toBeUndefined();
      expect(outstandingWhere.OR).toHaveLength(6);
      expect(outstandingWhere.OR[4]).toEqual({
        status: 'REJECTED',
        rawObjectKey: { startsWith: 'raw/' },
      });
      expect(outstandingWhere.OR[5]).toEqual({
        status: 'REJECTED',
        thumbObjectKey: { startsWith: 'thumb/' },
      });

      // Eligible predicate MUST restrict nextRetryAt to null or <= now
      expect(eligibleWhere.AND).toBeDefined();
      expect(eligibleWhere.AND[0]).toEqual(outstandingWhere);
      expect(eligibleWhere.AND[1]).toEqual({
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
      });
    });

    it('proves that a record in backoff is counted in backlog, failed-attempt, and oldest age metrics', async () => {
      const mockCount = vi.fn()
        .mockResolvedValueOnce(10) // totalBacklog
        .mockResolvedValueOnce(3);  // failedAttemptsCount
      (prisma.reportImage as any).count = mockCount;

      const mockFindFirst = vi.fn().mockResolvedValueOnce({
        createdAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      });
      (prisma.reportImage as any).findFirst = mockFindFirst;

      const metrics = await uploadsService.getCleanupMetrics(15);

      expect(metrics.totalBacklog).toBe(10);
      expect(metrics.failedAttemptsCount).toBe(3);
      expect(metrics.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(3590);

      // Verify prisma.reportImage.count received outstandingWhere WITHOUT nextRetryAt <= now filter
      const firstCountCallWhere = mockCount.mock.calls[0][0].where;
      expect(firstCountCallWhere.AND).toBeUndefined();
      expect(firstCountCallWhere.OR).toBeDefined();

      // Verify failed attempts count query checks cleanupAttempts > 0 on outstandingWhere
      const secondCountCallWhere = mockCount.mock.calls[1][0].where;
      expect(secondCountCallWhere.AND[1]).toEqual({ cleanupAttempts: { gt: 0 } });

      // Verify oldest age query checked outstandingWhere without nextRetryAt restriction
      const findFirstCallWhere = mockFindFirst.mock.calls[0][0].where;
      expect(findFirstCallWhere.AND).toBeUndefined();
    });

    it('proves that a record in backoff is not selected for processing until its retry time is due', async () => {
      vi.spyOn(storageAdapter, 'isStorageEnabled').mockReturnValue(true);

      const mockFindMany = vi.fn().mockResolvedValueOnce([]);
      (prisma.reportImage.findMany as any) = mockFindMany;

      await uploadsService.cleanupAbandonedUploads({ batchSize: 20 });

      // Verify findMany was called with eligibleWhere filter enforcing nextRetryAt <= now or null
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const whereArg = mockFindMany.mock.calls[0][0].where;

      expect(whereArg.AND).toBeDefined();
      expect(whereArg.AND[1]).toEqual({
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: expect.any(Date) } },
        ],
      });
    });
  });
});
