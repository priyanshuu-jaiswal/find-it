import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { CreateClaimSchema } from '@/src/modules/claims/schema';
import { claimsService } from '@/src/modules/claims/service';
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

    const parsed = CreateClaimSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid claim submission payload', parsed.error.format());
    }

    const result = await claimsService.submitClaim(user.id, id, parsed.data);
    return successResponse(result.data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
