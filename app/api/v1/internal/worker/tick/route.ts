import { NextRequest } from 'next/server';
import { jobRunner } from '@/src/jobs/runner';
import { env } from '@/src/lib/env';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import { z } from 'zod';

const WorkerTickSchema = z.object({
  batchSize: z.number().int().min(1).max(50).default(10),
});

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '');

    if (!token || token !== env.WORKER_SECRET) {
      throw new AppError('FORBIDDEN', 'Invalid or missing worker secret token');
    }

    const body = await req.json().catch(() => ({}));
    const parsed = WorkerTickSchema.safeParse(body);
    const batchSize = parsed.success ? parsed.data.batchSize : 10;

    const result = await jobRunner.tick(batchSize);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
