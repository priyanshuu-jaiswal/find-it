import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { FlagReportSchema } from '@/src/modules/moderation/schema';
import { moderationService } from '@/src/modules/moderation/service';
import { rateLimiter } from '@/src/lib/rate-limit';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;

    // Rate limit: max 10 flags per minute per user
    rateLimiter.check(`flag:${user.id}`, 10, 60_000);

    const body = await req.json().catch(() => null);
    if (!body) {
      throw new AppError('VALIDATION_ERROR', 'Missing request body');
    }

    const parsed = FlagReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid flag payload', parsed.error.format());
    }

    const result = await moderationService.flagReport(user.id, id, parsed.data);
    return successResponse(result.data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
