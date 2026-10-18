import { z } from 'zod';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export const PresignUploadSchema = z.object({
  orgId: z.string().uuid(),
  contentType: z.enum(ALLOWED_IMAGE_TYPES, {
    message: 'contentType must be one of image/jpeg, image/png, image/webp',
  }),
  byteSize: z
    .number()
    .int()
    .min(1, 'byteSize must be at least 1 byte')
    .max(MAX_UPLOAD_BYTES, 'byteSize cannot exceed 10MB'),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'sha256 must be a 64-character hex string')
    .optional(),
});

export type PresignUploadInput = z.infer<typeof PresignUploadSchema>;
