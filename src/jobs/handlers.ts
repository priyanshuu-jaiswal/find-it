import prisma from '@/src/db';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { imageProcessor } from '@/src/modules/uploads/image-processor';
import { detectImageSignature, isCompatibleMimeType } from '@/src/modules/uploads/validation';
import { MAX_UPLOAD_BYTES } from '@/src/modules/uploads/schema';
import { candidatesService } from '@/src/modules/matching/candidates';
import { AppError } from '@/src/lib/errors';
import logger, { sanitizeLogErr } from '@/src/lib/logger';

export class NonRetryableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableImageError';
  }
}

export interface ProcessImagePayload {
  imageId: string;
}

export interface ComputeMatchesPayload {
  reportId: string;
  organizationId: string;
}

export interface PurgeStoragePayload {
  objectKey: string;
  imageId?: string;
}

export async function handleProcessImage(payload: ProcessImagePayload): Promise<void> {
  const { imageId } = payload;
  logger.info({ imageId }, 'Processing image: verifying storage metadata and converting to WebP thumbnail');

  const reportImage = await prisma.reportImage.findUnique({
    where: { id: imageId },
  });

  if (!reportImage) {
    logger.warn({ imageId }, 'ReportImage not found; skipping processing');
    return;
  }

  if (reportImage.status === 'READY') {
    // If READY but rawObjectKey remains an unpurged remote key, purge it or enqueue a purge job
    const isUnpurgedRemote =
      Boolean(reportImage.rawObjectKey) &&
      !reportImage.rawObjectKey.startsWith('data:') &&
      !reportImage.rawObjectKey.startsWith('purged:');

    if (isUnpurgedRemote) {
      logger.info({ imageId }, 'Image is READY but raw object remains unpurged; purging raw object');
      let rawPurged = false;
      if (storageAdapter.isStorageEnabled()) {
        try {
          await storageAdapter.deleteObject(reportImage.rawObjectKey);
          rawPurged = true;
          await prisma.reportImage.update({
            where: { id: imageId },
            data: { rawObjectKey: `purged:${imageId}` },
          });
        } catch (delErr) {
          logger.warn(
            { imageId, ...sanitizeLogErr(delErr) },
            'Raw object deletion failed for READY image; enqueuing durable purge job'
          );
        }
      }

      if (!rawPurged) {
        try {
          await prisma.job.create({
            data: {
              kind: 'PURGE_STORAGE_OBJECT',
              dedupeKey: `purge_storage:${reportImage.rawObjectKey}`,
              payload: { objectKey: reportImage.rawObjectKey, imageId },
              status: 'QUEUED',
            },
          });
        } catch (jobErr: any) {
          if (jobErr?.code !== 'P2002') {
            throw jobErr;
          }
        }
      }
    } else {
      logger.info({ imageId }, 'Image is already processed and READY');
    }
    return;
  }

  if (reportImage.status === 'REJECTED') {
    // If REJECTED but rawObjectKey remains an unpurged remote key, retry raw-object deletion
    const isUnpurgedRemote =
      Boolean(reportImage.rawObjectKey) &&
      !reportImage.rawObjectKey.startsWith('data:') &&
      !reportImage.rawObjectKey.startsWith('purged:');

    if (isUnpurgedRemote) {
      logger.info(
        { imageId },
        'Image is already marked REJECTED but raw object remains unpurged; retrying deletion'
      );

      let rawPurged = false;
      if (storageAdapter.isStorageEnabled()) {
        try {
          await storageAdapter.deleteObject(reportImage.rawObjectKey);
          rawPurged = true;
          await prisma.reportImage.update({
            where: { id: imageId },
            data: {
              rawObjectKey: `purged:${imageId}`,
              cleanupAttempts: 0,
              nextRetryAt: null,
            },
          });
        } catch (delErr) {
          logger.warn(
            { imageId, ...sanitizeLogErr(delErr) },
            'Raw object deletion failed for REJECTED image; enqueuing durable purge job'
          );
        }
      }

      if (!rawPurged) {
        try {
          await prisma.job.create({
            data: {
              kind: 'PURGE_STORAGE_OBJECT',
              dedupeKey: `purge_storage:${reportImage.rawObjectKey}`,
              payload: { objectKey: reportImage.rawObjectKey, imageId },
              status: 'QUEUED',
            },
          });
        } catch (jobErr: any) {
          if (jobErr?.code !== 'P2002') {
            throw jobErr;
          }
        }
      }
    } else {
      logger.info(
        { imageId },
        'Image is already marked REJECTED and raw object is purged; skipping processing'
      );
    }
    return;
  }

  try {
    // 1. Verify actual uploaded object size from storage metadata before downloading
    if (storageAdapter.isStorageEnabled() && !reportImage.rawObjectKey.startsWith('data:')) {
      const head = await storageAdapter.headObject(reportImage.rawObjectKey);
      if (!head) {
        throw new NonRetryableImageError('Uploaded object not found in storage bucket');
      }

      if (head.contentLength <= 0) {
        throw new NonRetryableImageError('Uploaded object is empty');
      }

      if (head.contentLength > MAX_UPLOAD_BYTES) {
        throw new NonRetryableImageError(
          `Uploaded object size (${head.contentLength} bytes) exceeds maximum allowable limit of ${MAX_UPLOAD_BYTES} bytes`
        );
      }
    }

    // 2. Fetch raw uploaded image buffer from private storage with byte-ceiling
    const rawBuffer = await storageAdapter.getObjectBuffer(
      reportImage.rawObjectKey,
      MAX_UPLOAD_BYTES
    );

    // 3. Verify magic bytes signature matches declared image content type
    const signature = detectImageSignature(rawBuffer);
    if (!signature) {
      throw new NonRetryableImageError(
        'Corrupted or invalid image file signature. Expected authentic JPEG, PNG, WebP, or HEIC/HEIF photo.'
      );
    }

    if (!isCompatibleMimeType(reportImage.contentType, signature)) {
      throw new NonRetryableImageError(
        `Image signature (${signature}) does not match declared content type (${reportImage.contentType})`
      );
    }

    // 4. Strip EXIF/GPS, resize, and convert to WebP (with Sharp dimension/pixel guards)
    let processed;
    try {
      processed = await imageProcessor.processToThumbnail(rawBuffer);
    } catch (procErr: any) {
      throw new NonRetryableImageError(
        procErr.message || 'Image decoding failed or exceeds dimension/pixel bounds'
      );
    }

    // 5. Store sanitized WebP thumbnail
    const thumbObjectKey = `thumb/${reportImage.organizationId}/${reportImage.id}.webp`;
    await storageAdapter.putObject(thumbObjectKey, processed.buffer, 'image/webp');

    // 6. Update database record to READY
    await prisma.reportImage.update({
      where: { id: imageId },
      data: {
        status: 'READY',
        thumbObjectKey,
        width: processed.width,
        height: processed.height,
      },
    });

    // 7. Delete the raw unprocessed object to prevent storage leaks and avoid direct exposure
    const isRemoteRaw =
      Boolean(reportImage.rawObjectKey) &&
      !reportImage.rawObjectKey.startsWith('data:') &&
      !reportImage.rawObjectKey.startsWith('purged:');

    if (isRemoteRaw) {
      let rawPurged = false;
      if (storageAdapter.isStorageEnabled()) {
        try {
          await storageAdapter.deleteObject(reportImage.rawObjectKey);
          rawPurged = true;
          await prisma.reportImage.update({
            where: { id: imageId },
            data: {
              rawObjectKey: `purged:${imageId}`,
              cleanupAttempts: 0,
              nextRetryAt: null,
            },
          });
        } catch (delErr) {
          logger.warn(
            { imageId, ...sanitizeLogErr(delErr) },
            'Raw object deletion failed after processing; enqueuing durable cleanup retry'
          );
        }
      } else {
        logger.warn(
          { imageId },
          'Storage unconfigured after processing; enqueuing durable cleanup retry'
        );
      }

      // If raw deletion did not succeed, retain rawObjectKey and enqueue durable PURGE_STORAGE_OBJECT job.
      // Make failure to enqueue visible and retryable.
      if (!rawPurged) {
        try {
          await prisma.job.create({
            data: {
              kind: 'PURGE_STORAGE_OBJECT',
              dedupeKey: `purge_storage:${reportImage.rawObjectKey}`,
              payload: { objectKey: reportImage.rawObjectKey, imageId },
              status: 'QUEUED',
            },
          });
        } catch (jobErr: any) {
          if (jobErr?.code !== 'P2002') {
            throw jobErr;
          }
        }
      }
    }

    logger.info(
      { imageId, width: processed.width, height: processed.height },
      'Image successfully processed and sanitized'
    );
  } catch (err: any) {
    const isNonRetryable =
      err instanceof NonRetryableImageError ||
      err.name === 'NonRetryableImageError' ||
      (err instanceof AppError && err.code === 'VALIDATION_ERROR');

    if (isNonRetryable) {
      logger.error(
        { imageId, reason: err.message },
        'Image validation/size failed with non-retryable error; marking REJECTED and deleting object'
      );

      // Mark REJECTED in database
      try {
        await prisma.reportImage.update({
          where: { id: imageId },
          data: { status: 'REJECTED' },
        });
      } catch {
        // Ignore DB update error during error handling
      }

      // Delete the rejected raw object from storage
      const isRemoteRaw =
        Boolean(reportImage.rawObjectKey) &&
        !reportImage.rawObjectKey.startsWith('data:') &&
        !reportImage.rawObjectKey.startsWith('purged:');

      if (isRemoteRaw) {
        let rawDeleted = false;
        if (storageAdapter.isStorageEnabled()) {
          try {
            await storageAdapter.deleteObject(reportImage.rawObjectKey);
            rawDeleted = true;
            await prisma.reportImage
              .update({
                where: { id: imageId },
                data: {
                  rawObjectKey: `purged:${imageId}`,
                  cleanupAttempts: 0,
                  nextRetryAt: null,
                },
              })
              .catch(() => null);
          } catch (delErr) {
            logger.warn(
              { imageId, ...sanitizeLogErr(delErr) },
              'Failed to delete rejected raw object from storage; enqueuing durable purge job'
            );
          }
        }

        if (!rawDeleted) {
          // Keep rawObjectKey intact and enqueue durable purge job
          try {
            await prisma.job.create({
              data: {
                kind: 'PURGE_STORAGE_OBJECT',
                dedupeKey: `purge_storage:${reportImage.rawObjectKey}`,
                payload: { objectKey: reportImage.rawObjectKey, imageId },
                status: 'QUEUED',
              },
            });
          } catch (jobErr: any) {
            if (jobErr?.code !== 'P2002') {
              logger.error(
                { imageId, ...sanitizeLogErr(jobErr) },
                'Failed to enqueue purge job for rejected image; propagating failure for retry'
              );
              throw jobErr;
            }
          }
        }
      }

      // Return cleanly only if deletion succeeded or a durable PURGE_STORAGE_OBJECT job was enqueued
      return;
    }

    // Rethrow transient or unexpected errors for job runner retry
    throw err;
  }
}

export async function handlePurgeStorageObject(payload: PurgeStoragePayload): Promise<void> {
  const { objectKey, imageId } = payload;
  logger.info({ imageId }, 'Executing durable storage object purge retry');

  const isRemote =
    Boolean(objectKey) &&
    !objectKey.startsWith('data:') &&
    !objectKey.startsWith('purged:');

  if (isRemote) {
    if (!storageAdapter.isStorageEnabled()) {
      throw new Error(
        'Storage is unconfigured; cannot purge remote object'
      );
    }
    // deleteObject will throw on provider/network errors, or resolve on 204 or confirmed absent (404)
    await storageAdapter.deleteObject(objectKey);
  }

  // Deletion succeeded or absence confirmed: now mark object purged in DB if imageId provided
  if (imageId) {
    try {
      await prisma.reportImage.update({
        where: { id: imageId },
        data: {
          rawObjectKey: `purged:${imageId}`,
          cleanupAttempts: 0,
          nextRetryAt: null,
        },
      });
    } catch (dbErr: any) {
      if (dbErr?.code !== 'P2025') {
        throw dbErr;
      }
    }
  }
}

export async function handleComputeMatches(payload: ComputeMatchesPayload): Promise<void> {
  logger.info({ reportId: payload.reportId }, 'Running candidate match computation');
  await candidatesService.computeMatchesForReport(payload.reportId, payload.organizationId);
}
