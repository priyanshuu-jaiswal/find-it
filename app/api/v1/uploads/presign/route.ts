import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { PresignUploadSchema } from '@/src/modules/uploads/schema';
import { uploadsService } from '@/src/modules/uploads/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

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

    const result = await uploadsService.createPresignedUpload(user.id, parsed.data);
    return successResponse(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
