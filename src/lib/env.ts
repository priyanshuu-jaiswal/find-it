import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(16),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  WORKER_SECRET: z.string().default('local-dev-worker-secret-key'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  STORAGE_ENDPOINT: z.string().default(() => {
    return (
      process.env.STORAGE_ENDPOINT ||
      process.env.SUPABASE_S3_ENDPOINT ||
      (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/s3` : '') ||
      (process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/s3` : '') ||
      'http://localhost:9000'
    );
  }),
  STORAGE_REGION: z.string().default(() => {
    return process.env.STORAGE_REGION || process.env.SUPABASE_REGION || 'us-east-1';
  }),
  STORAGE_BUCKET: z.string().default(() => {
    return process.env.STORAGE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'findit-private';
  }),
  STORAGE_ACCESS_KEY_ID: z.string().default(() => {
    return (
      process.env.STORAGE_ACCESS_KEY_ID ||
      process.env.SUPABASE_S3_ACCESS_KEY_ID ||
      'minioadmin'
    );
  }),
  STORAGE_SECRET_ACCESS_KEY: z.string().default(() => {
    return (
      process.env.STORAGE_SECRET_ACCESS_KEY ||
      process.env.SUPABASE_S3_SECRET_ACCESS_KEY ||
      'minioadminpassword'
    );
  }),
  STORAGE_FORCE_PATH_STYLE: z.preprocess(
    (val) => (val !== undefined && val !== null ? val === 'true' || val === true : true),
    z.boolean()
  ).default(true),

  MAIL_FROM: z.string().default('FindIt <no-reply@example.test>'),
  MAIL_API_KEY: z.string().optional(),

  EMBEDDING_PROVIDER: z.enum(['none', 'gemini', 'openai']).default('none'),
  EMBEDDING_API_KEY: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().default(10485760),
});

export const env = envSchema.parse(process.env);
