import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { ListClaimsQuerySchema } from '@/src/modules/claims/schema';
import { claimsService } from '@/src/modules/claims/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = ListClaimsQuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid claim query parameters', parsed.error.format());
    }

    const result = await claimsService.listClaims(user.id, parsed.data);
    return successResponse(result.data, 200, { page: result.page });
  } catch (err) {
    return errorResponse(err);
  }
}
