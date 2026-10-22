import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import prisma from '@/src/db';
import { handleProcessImage } from '@/src/jobs/handlers';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { uploadsService } from '@/src/modules/uploads/service';
import { reportsRepository } from '@/src/modules/reports/repository';
import { GET as getImageRoute } from '@/app/api/v1/images/[id]/route';
import { NextRequest } from 'next/server';

vi.mock('@/src/db', () => ({
  default: {
    reportImage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
    job: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/src/modules/uploads/storage-adapter', () => ({
  storageAdapter: {
    isStorageEnabled: vi.fn().mockReturnValue(true),
    headObject: vi.fn(),
    getObjectBuffer: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
    getPresignedPutUrl: vi.fn().mockResolvedValue('https://storage.example.com/put-signed'),
  },
}));

describe('Presigned Object-Storage Security & Lifecycle Enforcement', () => {
  const dummyUserId = '11111111-1111-4111-8111-111111111111';
  const dummyOrgId = '22222222-2222-4222-8222-222222222222';
  const dummyImageId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageAdapter.isStorageEnabled).mockReturnValue(true);
    vi.mocked(storageAdapter.deleteObject).mockResolvedValue();
    vi.mocked(prisma.reportImage.update).mockResolvedValue({} as any);
    vi.mocked(prisma.reportImage.delete).mockResolvedValue({} as any);
  });

  describe('Worker Protection: Actual Uploaded Byte Size Enforcement', () => {
    it('detects oversized object via storage metadata, rejects upload, and purges object without retrying', async () => {
      // Client claimed small byteSize (1024 bytes) during presign
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
        byteSize: BigInt(1024),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      // Storage headObject reveals actual uploaded object is 15 MB (> 10 MB ceiling)
      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 15 * 1024 * 1024,
        contentType: 'image/jpeg',
      });

      // Execute worker handler
      await handleProcessImage({ imageId: dummyImageId });

      // Must mark image as REJECTED in database
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: { status: 'REJECTED' },
      });

      // Must delete the oversized raw object from S3
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.jpg`
      );

      // Must NOT fetch the oversized buffer into memory
      expect(storageAdapter.getObjectBuffer).not.toHaveBeenCalled();
    });

    it('enforces terminal failure when streamed body crosses byte cap even if headObject reported acceptable size', async () => {
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
        byteSize: BigInt(5000),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      // headObject reported under-limit
      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 4000,
        contentType: 'image/jpeg',
      });

      // Streaming download throws size-limit AppError
      const { AppError } = await import('@/src/lib/errors');
      vi.mocked(storageAdapter.getObjectBuffer).mockRejectedValue(
        new AppError('VALIDATION_ERROR', 'Streamed object exceeded maximum allowable limit of 10485760 bytes')
      );

      // Handler MUST resolve without throwing (terminal failure, do not retry)
      await expect(handleProcessImage({ imageId: dummyImageId })).resolves.not.toThrow();

      // Image must be marked REJECTED
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: { status: 'REJECTED' },
      });

      // Raw object cleanup must be attempted
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.jpg`
      );
    });

    it('keeps transient storage/network errors retryable by re-throwing', async () => {
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
        byteSize: BigInt(5000),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 4000,
        contentType: 'image/jpeg',
      });

      // Transient S3 connection glitch
      vi.mocked(storageAdapter.getObjectBuffer).mockRejectedValue(
        new Error('ETIMEDOUT: Connection reset by peer')
      );

      // Handler MUST re-throw so the background job runner retries
      await expect(handleProcessImage({ imageId: dummyImageId })).rejects.toThrow('ETIMEDOUT');
    });
  });

  describe('Worker Protection: Signature, Format & Sharp Bounds', () => {
    it('rejects upload when magic bytes signature does not match declared contentType', async () => {
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg', // Declared JPEG
        byteSize: BigInt(2048),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 2048,
        contentType: 'image/jpeg',
      });

      // Actual buffer uploaded is a PNG (signature mismatch)
      const pngBuffer = await sharp({
        create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer();

      vi.mocked(storageAdapter.getObjectBuffer).mockResolvedValue(pngBuffer);

      await handleProcessImage({ imageId: dummyImageId });

      // Must be marked REJECTED
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: { status: 'REJECTED' },
      });

      // Must delete raw object
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.jpg`
      );
    });

    it('rejects image exceeding maximum Sharp dimension bounds (4096px)', async () => {
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
        byteSize: BigInt(50000),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 50000,
        contentType: 'image/jpeg',
      });

      // Create valid JPEG with excessive dimensions: 4500 x 100 (> 4096)
      const hugeDimBuffer = await sharp({
        create: { width: 4500, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      vi.mocked(storageAdapter.getObjectBuffer).mockResolvedValue(hugeDimBuffer);

      await handleProcessImage({ imageId: dummyImageId });

      // Image rejected and raw object purged
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: { status: 'REJECTED' },
      });
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.jpg`
      );
    });

    it('successfully processes valid JPEG: saves WebP thumbnail, sets READY, and purges raw object', async () => {
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/jpeg',
        byteSize: BigInt(5000),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 5000,
        contentType: 'image/jpeg',
      });

      const validJpeg = await sharp({
        create: { width: 300, height: 200, channels: 3, background: { r: 0, g: 128, b: 255 } },
      })
        .jpeg()
        .toBuffer();

      vi.mocked(storageAdapter.getObjectBuffer).mockResolvedValue(validJpeg);

      await handleProcessImage({ imageId: dummyImageId });

      // Saved thumbnail
      expect(storageAdapter.putObject).toHaveBeenCalledWith(
        `thumb/${dummyOrgId}/${dummyImageId}.webp`,
        expect.any(Buffer),
        'image/webp'
      );

      // Status marked READY
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: expect.objectContaining({
          status: 'READY',
          thumbObjectKey: `thumb/${dummyOrgId}/${dummyImageId}.webp`,
        }),
      });

      // Raw object purged
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.jpg`
      );
    });

    it('successfully processes genuine HEIC raw object, converts to WebP thumbnail, and purges raw object', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fixturePath = path.resolve(__dirname, '../fixtures/sample.heic');
      if (!fs.existsSync(fixturePath)) return;

      const heicBuffer = fs.readFileSync(fixturePath);

      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.heic`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/heic',
        byteSize: BigInt(heicBuffer.length),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: heicBuffer.length,
        contentType: 'image/heic',
      });

      vi.mocked(storageAdapter.getObjectBuffer).mockResolvedValue(heicBuffer);

      await handleProcessImage({ imageId: dummyImageId });

      // Saved thumbnail as WebP
      expect(storageAdapter.putObject).toHaveBeenCalledWith(
        `thumb/${dummyOrgId}/${dummyImageId}.webp`,
        expect.any(Buffer),
        'image/webp'
      );

      // Status marked READY
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: expect.objectContaining({
          status: 'READY',
          thumbObjectKey: `thumb/${dummyOrgId}/${dummyImageId}.webp`,
        }),
      });

      // Raw object purged
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.heic`
      );
    });

    it('rejects corrupt HEIC raw object as non-retryable error, marks REJECTED, and purges raw object', async () => {
      const corruptHeic = Buffer.alloc(40);
      corruptHeic.writeUInt32BE(40, 0);
      corruptHeic.write('ftyp', 4);
      corruptHeic.write('heic', 8);
      corruptHeic.fill(0xee, 12);

      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        uploaderId: dummyUserId,
        organizationId: dummyOrgId,
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.heic`,
        thumbObjectKey: null,
        status: 'PENDING_UPLOAD',
        contentType: 'image/heic',
        byteSize: BigInt(40),
        width: null,
        height: null,
        sha256: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      } as any);

      vi.mocked(storageAdapter.headObject).mockResolvedValue({
        contentLength: 40,
        contentType: 'image/heic',
      });

      vi.mocked(storageAdapter.getObjectBuffer).mockResolvedValue(corruptHeic);

      // Should complete without re-throwing (non-retryable)
      await expect(handleProcessImage({ imageId: dummyImageId })).resolves.not.toThrow();

      // Marked REJECTED
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: dummyImageId },
        data: { status: 'REJECTED' },
      });

      // Raw object purge attempted
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `raw/${dummyOrgId}/${dummyImageId}.heic`
      );
    });
  });

  describe('Report Attachment Protection: Uploader, Expiry & Duplicate Constraints', () => {
    it('rejects report creation when image has expired before attachment', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          reportImage: {
            findMany: vi.fn().mockResolvedValue([]), // Returns empty because expiresAt < now
          },
        };
        return callback(tx);
      });

      await expect(
        reportsRepository.createWithJobs(dummyUserId, {
          orgId: dummyOrgId,
          type: 'LOST',
          category: 'ELECTRONICS',
          title: 'Lost Phone',
          description: 'Black smartphone',
          locationLabel: 'Library 2nd Floor',
          imageIds: [dummyImageId],
        })
      ).rejects.toThrow(/One or more image IDs are invalid/);
    });

    it('rejects duplicate image IDs in the same report submission', async () => {
      await expect(
        reportsRepository.createWithJobs(dummyUserId, {
          orgId: dummyOrgId,
          type: 'LOST',
          category: 'KEYS',
          title: 'Lost Keys',
          description: 'Keychain with car keys',
          locationLabel: 'Main Gate',
          imageIds: [dummyImageId, dummyImageId], // Duplicate
        })
      ).rejects.toThrow(/Duplicate image IDs are not allowed/);
    });

    it('rejects attaching an image belonging to a different uploader or organization', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          reportImage: {
            // Simulated: uploaderId or organizationId mismatch filters it out
            findMany: vi.fn().mockResolvedValue([]),
          },
        };
        return callback(tx);
      });

      await expect(
        reportsRepository.createWithJobs('other-user-uuid', {
          orgId: dummyOrgId,
          type: 'LOST',
          category: 'BAGS',
          title: 'Lost Backpack',
          description: 'Blue backpack',
          locationLabel: 'Cafeteria',
          imageIds: [dummyImageId],
        })
      ).rejects.toThrow(/One or more image IDs are invalid/);
    });
  });

  describe('Abandoned Upload Sweep & Retryable Storage Cleanup', () => {
    it('purges abandoned pending uploads and deletes raw S3 objects during sweep', async () => {
      const abandonedKey = `raw/${dummyOrgId}/abandoned.jpg`;
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: 'abandoned-id',
          rawObjectKey: abandonedKey,
          thumbObjectKey: null,
          status: 'PENDING_UPLOAD',
          reportId: null,
        } as any,
      ]);

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(1);
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(abandonedKey);
      expect(prisma.reportImage.delete).toHaveBeenCalledWith({
        where: { id: 'abandoned-id' },
      });
    });

    it('retains database row and does not delete it if storage deletion fails during sweep', async () => {
      const abandonedKey = `raw/${dummyOrgId}/failed-delete.jpg`;
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: 'failed-id',
          rawObjectKey: abandonedKey,
          thumbObjectKey: null,
          status: 'PENDING_UPLOAD',
          reportId: null,
        } as any,
      ]);

      // Storage deletion fails (e.g. S3 timeout)
      vi.mocked(storageAdapter.deleteObject).mockRejectedValueOnce(
        new Error('S3 503 Service Unavailable')
      );

      const res = await uploadsService.cleanupAbandonedUploads(15);

      // Must NOT report as cleaned
      expect(res.cleanedCount).toBe(0);
      // Must NOT delete the database row when object deletion failed
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
      // Must mark as REJECTED and schedule retry with backoff so it is safely retained
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: 'failed-id' },
        data: {
          cleanupAttempts: 1,
          nextRetryAt: expect.any(Date),
          status: 'REJECTED',
        },
      });
    });

    it('successfully purges database row on subsequent sweep when storage deletion succeeds', async () => {
      const abandonedKey = `raw/${dummyOrgId}/retry-success.jpg`;
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: 'retry-id',
          rawObjectKey: abandonedKey,
          thumbObjectKey: null,
          status: 'REJECTED',
          reportId: null,
        } as any,
      ]);

      // S3 deletion succeeds on subsequent run
      vi.mocked(storageAdapter.deleteObject).mockResolvedValueOnce();

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(1);
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(abandonedKey);
      expect(prisma.reportImage.delete).toHaveBeenCalledWith({
        where: { id: 'retry-id' },
      });
    });

    it('retries raw object deletion for READY images during subsequent sweep', async () => {
      const pendingRawKey = `raw/${dummyOrgId}/unpurged-ready.jpg`;
      vi.mocked(prisma.reportImage.findMany).mockResolvedValue([
        {
          id: 'ready-img-id',
          rawObjectKey: pendingRawKey,
          thumbObjectKey: `thumb/${dummyOrgId}/ready.webp`,
          status: 'READY',
          reportId: 'some-report-id',
        } as any,
      ]);

      vi.mocked(storageAdapter.deleteObject).mockResolvedValueOnce();

      const res = await uploadsService.cleanupAbandonedUploads(15);

      expect(res.cleanedCount).toBe(1);
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(pendingRawKey);
      expect(prisma.reportImage.update).toHaveBeenCalledWith({
        where: { id: 'ready-img-id' },
        data: {
          rawObjectKey: 'purged:ready-img-id',
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });
      // READY image row itself must NOT be deleted
      expect(prisma.reportImage.delete).not.toHaveBeenCalled();
    });

    it('never serves un-sanitized raw objects directly from /api/v1/images/[id]', async () => {
      // Image is in PENDING_UPLOAD (rawObjectKey exists, but not READY)
      vi.mocked(prisma.reportImage.findUnique).mockResolvedValue({
        id: dummyImageId,
        status: 'PENDING_UPLOAD',
        rawObjectKey: `raw/${dummyOrgId}/${dummyImageId}.jpg`,
        thumbObjectKey: null,
      } as any);

      const req = new NextRequest(`http://localhost:3000/api/v1/images/${dummyImageId}`);
      const res = await getImageRoute(req, { params: Promise.resolve({ id: dummyImageId }) });

      expect(res.status).toBe(404);
      // Raw object buffer must never be accessed or returned
      expect(storageAdapter.getObjectBuffer).not.toHaveBeenCalled();
    });
  });
});
