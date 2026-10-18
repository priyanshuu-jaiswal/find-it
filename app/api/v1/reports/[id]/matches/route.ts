import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { GetMatchesQuerySchema } from '@/src/modules/matching/schema';
import { matchingService } from '@/src/modules/matching/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;

    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = GetMatchesQuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid match query parameters', parsed.error.format());
    }

    const result = await matchingService.getMatchesForReport(
      user.id,
      id,
      parsed.data.includeDismissed
    );

    return successResponse(result.data);
  } catch (err) {
    return errorResponse(err);
  }
}
