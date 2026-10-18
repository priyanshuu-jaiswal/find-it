import { z } from 'zod';

export const FlagReportSchema = z.object({
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason cannot exceed 500 characters'),
});

export type FlagReportInput = z.infer<typeof FlagReportSchema>;

export const ModerationActionSchema = z.object({
  action: z.enum(['HIDE', 'RESTORE', 'DISMISS_FLAGS'], {
    message: 'action must be one of HIDE, RESTORE, DISMISS_FLAGS',
  }),
  note: z
    .string()
    .min(3, 'Review note must be at least 3 characters')
    .max(500, 'Review note cannot exceed 500 characters'),
});

export type ModerationActionInput = z.infer<typeof ModerationActionSchema>;

export const ListModerationQueueSchema = z.object({
  orgId: z.string().uuid(),
  status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).default('OPEN'),
});

export type ListModerationQueueQuery = z.infer<typeof ListModerationQueueSchema>;
