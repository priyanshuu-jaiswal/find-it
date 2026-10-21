import { NextRequest } from 'next/server';
import crypto from 'crypto';
import sharp, { Metadata } from 'sharp';
import prisma from '@/src/db';
import { requireAuth } from '@/src/auth';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import logger from '@/src/lib/logger';
import { rateLimiter } from '@/src/lib/rate-limit';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/src/modules/uploads/schema';
import { detectImageSignature } from '@/src/modules/uploads/validation';
import { createBoundedStream } from '@/src/modules/uploads/stream-limiter';

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

    // Validate declared MIME type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unsupported file type '${file.type}'. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`
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
        'Corrupted or invalid image file signature. Please upload an authentic JPEG, PNG, or WebP photo.'
      );
    }

    // 2. Ensure declared MIME type matches verified magic bytes
    if (detectedSignature !== file.type) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Declared MIME type '${file.type}' does not match detected image format '${detectedSignature}'.`
      );
    }

    // 3. Deep image validation with Sharp parser (mitigates decompression bombs and malformed files)
    const MAX_IMAGE_DIMENSION = 4096;
    const MAX_IMAGE_PIXELS = 16_777_216; // 4096 * 4096

    let metadata: Metadata;
    try {
      metadata = await sharp(rawBuffer, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
      }).metadata();
    } catch {
      throw new AppError(
        'VALIDATION_ERROR',
        'Image parsing failed. The uploaded file is corrupted, malformed, or exceeds decompression safety limits.'
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new AppError('VALIDATION_ERROR', 'Unable to determine image dimensions.');
    }

    if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Image dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}.`
      );
    }

    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Image pixel count exceeds maximum allowable decompression ceiling.'
      );
    }

    // 4. Process image with Sharp: strip EXIF/GPS, resize to 800px max, convert to WebP
    let processedBuffer: Buffer;
    try {
      processedBuffer = await sharp(rawBuffer, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
      })
        .rotate() // Auto-orient using EXIF before stripping
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch {
      throw new AppError(
        'VALIDATION_ERROR',
        'Failed to process image thumbnail. The file may be corrupted.'
      );
    }

    const processedMeta = await sharp(processedBuffer).metadata();
    const width = processedMeta.width ?? 800;
    const height = processedMeta.height ?? 600;

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

    // Record READY image directly in DB. Because direct uploads process in memory
    // and write only thumbnails without creating an unpurged raw S3 object, rawObjectKey
    // is recorded as purged to avoid unnecessary orphaned raw object sweeps.
    const reportImage = await prisma.reportImage.create({
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
