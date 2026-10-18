import prisma from '@/src/db';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { imageProcessor } from '@/src/modules/uploads/image-processor';
import { candidatesService } from '@/src/modules/matching/candidates';
import logger from '@/src/lib/logger';

export interface ProcessImagePayload {
  imageId: string;
}

export interface ComputeMatchesPayload {
  reportId: string;
  organizationId: string;
}

export async function handleProcessImage(payload: ProcessImagePayload): Promise<void> {
  const { imageId } = payload;
  logger.info({ imageId }, 'Processing image: stripping EXIF metadata and creating WebP thumbnail');

  const reportImage = await prisma.reportImage.findUnique({
    where: { id: imageId },
  });

  if (!reportImage) {
    throw new Error(`ReportImage with ID '${imageId}' not found`);
  }

  if (reportImage.status === 'READY') {
    logger.info({ imageId }, 'Image is already processed and READY');
    return;
  }

  // 1. Fetch raw uploaded image buffer from private storage
  const rawBuffer = await storageAdapter.getObjectBuffer(reportImage.rawObjectKey);

  // 2. Strip EXIF/GPS, resize, and convert to WebP
  const processed = await imageProcessor.processToThumbnail(rawBuffer);

  // 3. Store sanitized WebP thumbnail
  const thumbObjectKey = `thumb/${reportImage.organizationId}/${reportImage.id}.webp`;
  await storageAdapter.putObject(thumbObjectKey, processed.buffer, 'image/webp');

  // 4. Update database record to READY
  await prisma.reportImage.update({
    where: { id: imageId },
    data: {
      status: 'READY',
      thumbObjectKey,
      width: processed.width,
      height: processed.height,
    },
  });

  logger.info({ imageId, thumbObjectKey, width: processed.width, height: processed.height }, 'Image successfully processed');
}

export async function handleComputeMatches(payload: ComputeMatchesPayload): Promise<void> {
  logger.info({ reportId: payload.reportId }, 'Running candidate match computation');
  await candidatesService.computeMatchesForReport(payload.reportId, payload.organizationId);
}
