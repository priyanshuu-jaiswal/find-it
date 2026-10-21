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
        'External S3 storage is not configured for presigned uploads. Please use direct upload.'
      );
    }

    const result = await uploadsService.createPresignedUpload(user.id, parsed.data);
    return successResponse(result, 201);
  } catch (err) {
    logger.error({ err }, 'Presign upload failed');
    return errorResponse(err);
  }
}
