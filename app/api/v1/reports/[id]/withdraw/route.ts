import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { WithdrawReportSchema } from '@/src/modules/reports/schema';
import { reportsService } from '@/src/modules/reports/service';
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

    const parsed = WithdrawReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid withdraw payload', parsed.error.format());
    }

    const result = await reportsService.withdrawReport(user.id, id, parsed.data.version);
    return successResponse(result.data);
  } catch (err) {
    return errorResponse(err);
  }
}
