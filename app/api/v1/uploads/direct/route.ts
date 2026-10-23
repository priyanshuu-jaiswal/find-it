import { NextRequest } from 'next/server';
import crypto from 'crypto';
import prisma from '@/src/db';
import { requireAuth } from '@/src/auth';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import logger from '@/src/lib/logger';
import { rateLimiter } from '@/src/lib/rate-limit';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/src/modules/uploads/schema';
import { detectImageSignature, isCompatibleMimeType } from '@/src/modules/uploads/validation';
import { imageProcessor } from '@/src/modules/uploads/image-processor';
import { createBoundedStream } from '@/src/modules/uploads/stream-limiter';

let schemaSyncPromise: Promise<void> | null = null;
async function ensureProductionSchema() {
  if (!schemaSyncPromise) {
    schemaSyncPromise = (async () => {
      try {
        if (typeof prisma.$executeRawUnsafe === 'function') {
          // 1. Ensure cleanup retry columns exist on report_images (handles unmigrated DBs)
          await prisma.$executeRawUnsafe(
            'ALTER TABLE report_images ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0;'
          );
          await prisma.$executeRawUnsafe(
            'ALTER TABLE report_images ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;'
          );
          // 2. Ensure legacy unique constraint on thumb_object_key is dropped to permit large thumbnails
          await prisma.$executeRawUnsafe(
            'ALTER TABLE report_images DROP CONSTRAINT IF EXISTS report_images_thumb_object_key_key;'
          );
          await prisma.$executeRawUnsafe(
            'DROP INDEX IF EXISTS report_images_thumb_object_key_key;'
          );
        }
      } catch (e) {
        logger.warn({ err: e }, 'Could not proactively sync schema columns');
      }
    })();
  }
  return schemaSyncPromise;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    // Pre-flight check: Inspect content-length header before buffering full multipart body
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_UPLOAD_BYTES + 65536) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Payload exceeds maximum upload size limit of 10MB`
      );
    }

    // Stream bounding: enforce a byte ceiling directly on the incoming readable stream
    // before formData parsing to guarantee oversized chunked/spoofed streams cannot buffer indefinitely
    let formData: FormData | null = null;
    if (req.body) {
      try {
        const boundedStream = createBoundedStream(req.body, MAX_UPLOAD_BYTES + 65536);
        const boundedReq = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: boundedStream,
          duplex: 'half',
        } as any);
        formData = await boundedReq.formData();
      } catch (streamErr: any) {
        if (streamErr instanceof AppError) {
          throw streamErr;
        }
        throw new AppError(
          'VALIDATION_ERROR',
          'Upload payload exceeds maximum allowable size limit of 10MB or stream was interrupted.'
        );
      }
    } else {
      formData = await req.formData().catch(() => null);
    }

    if (!formData) {
      throw new AppError('VALIDATION_ERROR', 'Expected multipart/form-data payload');
    }

    // Enforce single file per request
    const allFiles = formData.getAll('file');
    if (allFiles.length > 1) {
      throw new AppError('VALIDATION_ERROR', 'Only a single file can be uploaded per request');
    }

    const file = formData.get('file') as File | null;
    const orgId = formData.get('orgId') as string | null;

    if (!file || !(file instanceof File)) {
      throw new AppError('VALIDATION_ERROR', 'A valid file must be provided');
    }

    if (!orgId) {
      throw new AppError('VALIDATION_ERROR', 'orgId is required');
    }

    // Verify user membership in organization (404 on cross-org attempt)
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: user.id,
        },
      },
    });

    if (!membership) {
      throw new AppError('NOT_FOUND', 'Organization not found or you are not a member');
    }

    // Rate limit: max 20 uploads per minute per user
    rateLimiter.check(
      `upload:${user.id}`,
      process.env.NODE_ENV === 'test' ? 100 : 20,
      60_000
    );

    // Infer MIME type if missing or generic octet-stream (common in mobile file pickers)
    let declaredType = file.type;
    if (!declaredType || declaredType === 'application/octet-stream') {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'heic' || ext === 'heif') declaredType = 'image/heic';
      else if (ext === 'jpg' || ext === 'jpeg') declaredType = 'image/jpeg';
      else if (ext === 'png') declaredType = 'image/png';
      else if (ext === 'webp') declaredType = 'image/webp';
    }

    // Validate declared MIME type
    if (!ALLOWED_IMAGE_TYPES.includes(declaredType as any)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unsupported file type '${file.type || declaredType || 'unknown'}'. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`
      );
    }

    // Validate file size
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(
        'VALIDATION_ERROR',
        `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds limit of 10MB`
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const rawBuffer = Buffer.from(arrayBuffer);

    // 1. Verify magic bytes signature (rejects extension-spoofed binaries)
    const detectedSignature = detectImageSignature(rawBuffer);
    if (!detectedSignature) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Corrupted or invalid image file signature. Please upload an authentic JPEG, PNG, WebP, or HEIC/HEIF photo.'
      );
    }

    // 2. Ensure declared MIME type matches verified magic bytes
    if (!isCompatibleMimeType(declaredType, detectedSignature)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Declared MIME type '${declaredType}' does not match detected image format '${detectedSignature}'.`
      );
    }

    // 3. Process image thumbnail: strips EXIF/GPS, resizes to WebP, handles HEIC decoding, validates dimensions & decompression bounds
    let processed;
    try {
      processed = await imageProcessor.processToThumbnail(rawBuffer);
    } catch (procErr: any) {
      if (procErr instanceof AppError) {
        throw procErr;
      }
      throw new AppError(
        'VALIDATION_ERROR',
        procErr.message || 'Image parsing failed. The uploaded file is corrupted, malformed, or exceeds decompression safety limits.'
      );
    }

    const processedBuffer = processed.buffer;
    const width = processed.width;
    const height = processed.height;

    const imageId = crypto.randomUUID();
    const thumbObjectKey = `thumb/${orgId}/${imageId}.webp`;

    let storedThumbKey = thumbObjectKey;

    // Check if external cloud storage (MinIO / Supabase S3 / AWS S3) is active
    if (storageAdapter.isStorageEnabled()) {
      try {
        await storageAdapter.putObject(thumbObjectKey, processedBuffer, 'image/webp');
        logger.info({ imageId }, 'Stored image in external storage');
      } catch (storageErr) {
        logger.warn(
          { storageErr, imageId },
          'External storage unavailable; falling back to WebP database storage'
        );
        storedThumbKey = `data:image/webp;base64,${processedBuffer.toString('base64')}`;
      }
    } else {
      storedThumbKey = `data:image/webp;base64,${processedBuffer.toString('base64')}`;
    }

    // Ensure production database schema has required columns and legacy constraints removed
    await ensureProductionSchema();

    // Record READY image directly in DB. Because direct uploads process in memory
    // and write only thumbnails without creating an unpurged raw S3 object, rawObjectKey
    // is recorded as purged to avoid unnecessary orphaned raw object sweeps.
    let reportImage;
    try {
      reportImage = await prisma.reportImage.create({
        data: {
          id: imageId,
          uploaderId: user.id,
          organizationId: orgId,
          rawObjectKey: `purged:${imageId}`,
          thumbObjectKey: storedThumbKey,
          status: 'READY',
          contentType: 'image/webp',
          byteSize: BigInt(processedBuffer.length),
          width,
          height,
        },
      });
    } catch (dbErr: any) {
      // Self-heal: If unmigrated DB is missing cleanup_attempts/next_retry_at (P2022) or
      // legacy B-tree unique index on thumb_object_key fails on large base64 thumbnails (Postgres 54000),
      // apply schema patch on demand and immediately retry the insert.
      const isMissingColumnErr =
        dbErr?.code === 'P2022' ||
        dbErr?.message?.includes('cleanup_attempts') ||
        dbErr?.message?.includes('does not exist');

      const isIndexLimitErr =
        dbErr?.code === 'P2010' ||
        dbErr?.code === 'P2002' ||
        dbErr?.message?.includes('54000') ||
        dbErr?.message?.includes('report_images_thumb_object_key_key') ||
        dbErr?.message?.includes('index row requires') ||
        dbErr?.message?.includes('maximum size is 8191');

      if (isMissingColumnErr || isIndexLimitErr) {
        try {
          logger.warn({ imageId, isMissingColumnErr, isIndexLimitErr }, 'Self-healing database schema on demand and retrying insert');
          schemaSyncPromise = null;
          if (typeof prisma.$executeRawUnsafe === 'function') {
            await prisma.$executeRawUnsafe(
              'ALTER TABLE report_images ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0;'
            );
            await prisma.$executeRawUnsafe(
              'ALTER TABLE report_images ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;'
            );
            await prisma.$executeRawUnsafe(
              'ALTER TABLE report_images DROP CONSTRAINT IF EXISTS report_images_thumb_object_key_key;'
            );
            await prisma.$executeRawUnsafe(
              'DROP INDEX IF EXISTS report_images_thumb_object_key_key;'
            );
          }
          reportImage = await prisma.reportImage.create({
            data: {
              id: imageId,
              uploaderId: user.id,
              organizationId: orgId,
              rawObjectKey: `purged:${imageId}`,
              thumbObjectKey: storedThumbKey,
              status: 'READY',
              contentType: 'image/webp',
              byteSize: BigInt(processedBuffer.length),
              width,
              height,
            },
          });
        } catch (retryErr) {
          logger.error({ retryErr, imageId }, 'Failed insert retry after self-healing schema');
          throw new AppError('INTERNAL', 'Failed to save uploaded photo record. Please try again.');
        }
      } else {
        logger.error({ dbErr, imageId }, 'Failed to save report image in database');
        throw new AppError('INTERNAL', 'Failed to save uploaded photo record. Please try again.');
      }
    }

    return successResponse(
      {
        imageId: reportImage.id,
        thumbUrl: `/api/v1/images/${reportImage.id}`,
        width: reportImage.width,
        height: reportImage.height,
      },
      201
    );
  } catch (err) {
    logger.error({ err }, 'Direct image upload failed');
    return errorResponse(err);
  }
}
