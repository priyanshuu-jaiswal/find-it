import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { CreateMessageSchema } from '@/src/modules/claims/schema';
import { claimsService } from '@/src/modules/claims/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;

    const result = await claimsService.getMessages(user.id, id);
    return successResponse(result.data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;

    const body = await req.json().catch(() => null);
    if (!body) {
      throw new AppError('VALIDATION_ERROR', 'Missing request body');
    }

    const parsed = CreateMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid message payload', parsed.error.format());
    }

    const result = await claimsService.postMessage(user.id, id, parsed.data.body);
    return successResponse(result.data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
