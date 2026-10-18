import { z } from 'zod';

export const ReportTypeEnum = z.enum(['LOST', 'FOUND']);
export type ReportType = z.infer<typeof ReportTypeEnum>;

export const CreateReportSchema = z.object({
  orgId: z.string().uuid(),
  type: ReportTypeEnum,
  category: z.string().min(1).max(50),
  title: z.string().min(3, 'Title must be at least 3 characters').max(100, 'Title cannot exceed 100 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(3000, 'Description cannot exceed 3000 characters'),
  color: z.string().max(50).optional().nullable(),
  brand: z.string().max(50).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
  locationLabel: z.string().min(2, 'Location label must be at least 2 characters').max(100, 'Location label cannot exceed 100 characters'),
  locationArea: z.string().max(100).optional().nullable(),
  imageIds: z.array(z.string().uuid()).max(5, 'Maximum of 5 images allowed per report').optional().default([]),
});

export type CreateReportInput = z.infer<typeof CreateReportSchema>;

export const UpdateReportSchema = z.object({
  version: z.number().int().min(1, 'version must be an integer >= 1'),
  title: z.string().min(3).max(100).optional(),
  description: z.string().min(10).max(3000).optional(),
  category: z.string().min(1).max(50).optional(),
  color: z.string().max(50).optional().nullable(),
  brand: z.string().max(50).optional().nullable(),
  locationLabel: z.string().min(2).max(100).optional(),
  locationArea: z.string().max(100).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
});

export type UpdateReportInput = z.infer<typeof UpdateReportSchema>;

export const WithdrawReportSchema = z.object({
  version: z.number().int().min(1, 'version must be an integer >= 1'),
});

export type WithdrawReportInput = z.infer<typeof WithdrawReportSchema>;

export const ListReportsQuerySchema = z.object({
  orgId: z.string().uuid(),
  type: ReportTypeEnum.optional(),
  category: z.string().optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListReportsQuery = z.infer<typeof ListReportsQuerySchema>;
