import { NextRequest } from 'next/server';
import { jobRunner } from '@/src/jobs/runner';
import { env } from '@/src/lib/env';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import { z } from 'zod';

const WorkerTickSchema = z.object({
  batchSize: z.number().int().min(1).max(50).default(10),
});

function verifyWorkerAuth(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron =
    req.headers.get('user-agent')?.includes('vercel-cron') ||
    Boolean(req.headers.get('x-vercel-cron'));

  const isValid =
    (token && token === env.WORKER_SECRET) ||
    (cronSecret && token === cronSecret) ||
    (isVercelCron && !cronSecret);

  if (!isValid) {
    throw new AppError('FORBIDDEN', 'Invalid or missing worker secret token');
  }
}

export async function GET(req: NextRequest) {
  try {
    verifyWorkerAuth(req);
    const result = await jobRunner.tick(10);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    verifyWorkerAuth(req);

    const body = await req.json().catch(() => ({}));
    const parsed = WorkerTickSchema.safeParse(body);
    const batchSize = parsed.success ? parsed.data.batchSize : 10;

    const result = await jobRunner.tick(batchSize);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
