import pino from 'pino';

export interface SanitizedErrorInfo {
  errorName: string;
  errorCode?: string | number;
}

/**
 * Extracts non-sensitive error metadata (type name and code/status) for logging,
 * strictly preventing raw exception messages, URLs, keys, database connection strings,
 * or credentials from being logged.
 */
export function sanitizeLogErr(err: unknown): SanitizedErrorInfo {
  if (!err || typeof err !== 'object') {
    return { errorName: 'UnknownError' };
  }
  const e = err as any;
  const errorName = typeof e.name === 'string' && e.name ? e.name : 'Error';
  const errorCode = e.code ?? e.$metadata?.httpStatusCode ?? undefined;
  return {
    errorName,
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'authorization',
      'cookie',
      'proofText',
      'proof_text',
      'body',
      'password',
      'rawObjectKey',
      'thumbObjectKey',
      'objectKey',
      '*.proofText',
      '*.proof_text',
      '*.body',
      '*.rawObjectKey',
      '*.thumbObjectKey',
      '*.objectKey',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? undefined
      : undefined,
});

export default logger;
