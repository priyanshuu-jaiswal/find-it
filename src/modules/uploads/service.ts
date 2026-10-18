import crypto from 'crypto';
import prisma from '@/src/db';
import { storageAdapter } from './storage-adapter';
import { PresignUploadInput } from './schema';
import { AppError } from '@/src/lib/errors';

export class UploadsService {
  async createPresignedUpload(userId: string, input: PresignUploadInput) {
    // 1. Verify user membership in organization (404 on cross-org attempt to prevent UUID enumeration)
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new AppError('NOT_FOUND', 'Organization not found or you are not a member');
    }

    // 2. Generate unique object key
    const imageId = crypto.randomUUID();
    const ext = input.contentType.split('/')[1] || 'bin';
    const rawObjectKey = `raw/${input.orgId}/${imageId}.${ext}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

    // 3. Record pending upload row
    const reportImage = await prisma.reportImage.create({
      data: {
        id: imageId,
        uploaderId: userId,
        organizationId: input.orgId,
        rawObjectKey,
        status: 'PENDING_UPLOAD',
        contentType: input.contentType,
        byteSize: BigInt(input.byteSize),
        sha256: input.sha256,
        expiresAt,
      },
    });

    // 4. Generate presigned PUT URL
    const putUrl = await storageAdapter.getPresignedPutUrl(rawObjectKey, input.contentType, 900);

    return {
      imageId: reportImage.id,
      putUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

export const uploadsService = new UploadsService();
