import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/src/auth';
import { MatchFeedbackSchema } from '@/src/modules/matching/schema';
import { matchingService } from '@/src/modules/matching/service';
import { errorResponse } from '@/src/lib/response';
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

    const parsed = MatchFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid match feedback payload', parsed.error.format());
    }

    await matchingService.recordFeedback(user.id, id, parsed.data);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
