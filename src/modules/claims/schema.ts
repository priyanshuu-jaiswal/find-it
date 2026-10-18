import { z } from 'zod';

export const CreateClaimSchema = z.object({
  proofText: z
    .string()
    .min(10, 'Proof description must be at least 10 characters')
    .max(1500, 'Proof description cannot exceed 1500 characters'),
});

export type CreateClaimInput = z.infer<typeof CreateClaimSchema>;

export const ClaimDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  decisionNote: z.string().max(500).optional().nullable(),
});

export type ClaimDecisionInput = z.infer<typeof ClaimDecisionSchema>;

export const ListClaimsQuerySchema = z.object({
  orgId: z.string().uuid(),
  box: z.enum(['incoming', 'outgoing']).default('incoming'),
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'HANDOFF_CONFIRMED'])
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListClaimsQuery = z.infer<typeof ListClaimsQuerySchema>;

export const CreateMessageSchema = z.object({
  body: z
    .string()
    .min(1, 'Message body cannot be empty')
    .max(2000, 'Message body cannot exceed 2000 characters'),
});

export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

export const ConfirmHandoffSchema = z.object({
  note: z.string().max(500).optional().nullable(),
});

export type ConfirmHandoffInput = z.infer<typeof ConfirmHandoffSchema>;
