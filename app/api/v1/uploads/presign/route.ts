import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { PresignUploadSchema } from '@/src/modules/uploads/schema';
import { uploadsService } from '@/src/modules/uploads/service';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import logger from '@/src/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const body = await req.json().catch(() => null);
    if (!body) {
      throw new AppError('VALIDATION_ERROR', 'Missing request body');
    }

    const parsed = PresignUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid presign upload payload', parsed.error.format());
    }

    // Verify external storage is enabled (in dev/test with MinIO or in production with configured S3/Supabase)
    if (!storageAdapter.isStorageEnabled()) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Cloud storage (S3/R2) is not configured in this deployment. Photos over 4.3 MB require cloud storage. Please configure STORAGE_* environment variables or choose a photo under 4.3 MB.'
      );
    }

    const result = await uploadsService.createPresignedUpload(user.id, parsed.data);
    return successResponse(result, 201);
  } catch (err) {
    logger.error({ err }, 'Presign upload failed');
    return errorResponse(err);
  }
}
