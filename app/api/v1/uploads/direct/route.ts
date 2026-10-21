import { NextRequest } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import prisma from '@/src/db';
import { requireAuth } from '@/src/auth';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import logger from '@/src/lib/logger';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/src/modules/uploads/schema';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      throw new AppError('VALIDATION_ERROR', 'Expected multipart/form-data payload');
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

    // Validate MIME type
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

    // Process image with Sharp: strip EXIF/GPS, resize to 800px max, convert to WebP
    const arrayBuffer = await file.arrayBuffer();
    const rawBuffer = Buffer.from(arrayBuffer);

    const processedBuffer = await sharp(rawBuffer)
      .rotate() // Auto-orient using EXIF before stripping
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

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
        logger.info({ imageId, thumbObjectKey }, 'Stored image in external storage');
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

    // Record READY image directly in DB
    const reportImage = await prisma.reportImage.create({
      data: {
        id: imageId,
        uploaderId: user.id,
        organizationId: orgId,
        rawObjectKey: `raw/${orgId}/${imageId}.webp`,
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
