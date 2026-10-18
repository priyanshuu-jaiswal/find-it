import { z } from 'zod';

export const GetMatchesQuerySchema = z.object({
  includeDismissed: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),
});

export type GetMatchesQuery = z.infer<typeof GetMatchesQuerySchema>;

export const MatchFeedbackSchema = z
  .object({
    useful: z.boolean().optional(),
    dismissed: z.boolean().optional(),
  })
  .refine(
    (data) => data.useful !== undefined || data.dismissed !== undefined,
    { message: 'At least one of useful or dismissed must be specified' }
  );

export type MatchFeedbackInput = z.infer<typeof MatchFeedbackSchema>;
