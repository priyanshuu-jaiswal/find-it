import pino from 'pino';

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
      '*.proofText',
      '*.proof_text',
      '*.body',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? undefined
      : undefined,
});

export default logger;
