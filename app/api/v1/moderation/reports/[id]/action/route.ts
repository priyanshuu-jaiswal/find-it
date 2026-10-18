import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { ModerationActionSchema } from '@/src/modules/moderation/schema';
import { moderationService } from '@/src/modules/moderation/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;

    const body = await req.json().catch(() => null);
    if (!body) {
      throw new AppError('VALIDATION_ERROR', 'Missing request body');
    }

    const parsed = ModerationActionSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid moderation action payload', parsed.error.format());
    }

    const result = await moderationService.takeAction(user.id, id, parsed.data);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
