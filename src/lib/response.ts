import { NextResponse } from 'next/server';
import { AppError } from './errors';
import logger from './logger';
import crypto from 'crypto';

export function successResponse<T>(data: T, status = 200, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      data,
      ...extra,
    },
    { status }
  );
}

export function errorResponse(error: unknown, reqRequestId?: string) {
  const requestId = reqRequestId || crypto.randomUUID();

  if (error instanceof AppError) {
    logger.warn({ requestId, code: error.code, message: error.message }, 'Application error');
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          details: error.details,
        },
      },
      { status: error.statusCode }
    );
  }

  logger.error({ requestId, err: error }, 'Unhandled server error');
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL',
        message: 'An unexpected internal error occurred',
        requestId,
      },
    },
    { status: 500 }
  );
}
