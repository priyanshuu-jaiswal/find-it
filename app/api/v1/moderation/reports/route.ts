import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { ListModerationQueueSchema } from '@/src/modules/moderation/schema';
import { moderationService } from '@/src/modules/moderation/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = ListModerationQueueSchema.safeParse(searchParams);

    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid moderation query parameters', parsed.error.format());
    }

    const result = await moderationService.getModerationQueue(user.id, parsed.data);
    return successResponse(result.data);
  } catch (err) {
    return errorResponse(err);
  }
}
