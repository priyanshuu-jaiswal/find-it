import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import { CreateReportSchema, ListReportsQuerySchema } from '@/src/modules/reports/schema';
import { reportsService } from '@/src/modules/reports/service';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import { rateLimiter } from '@/src/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    // Rate-limit report creations per user: max 15 per minute (100 in test)
    rateLimiter.check(
      `report:create:${user.id}`,
      process.env.NODE_ENV === 'test' ? 100 : 15,
      60_000
    );

    const body = await req.json().catch(() => null);
    if (!body) {
      throw new AppError('VALIDATION_ERROR', 'Missing request body');
    }

    const parsed = CreateReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid report creation payload', parsed.error.format());
    }

    const report = await reportsService.createReport(user.id, parsed.data);
    return successResponse(report, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = ListReportsQuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid report query parameters', parsed.error.format());
    }

    const result = await reportsService.listReports(user.id, parsed.data);
    return successResponse(result.data, 200, { page: result.page });
  } catch (err) {
    return errorResponse(err);
  }
}
