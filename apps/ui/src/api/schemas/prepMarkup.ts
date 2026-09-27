import { z } from 'zod';
import type { PrepMarkupChapter, PrepMarkupSpan } from '../contracts/prepMarkup';

export const prepMarkupSpanSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string(),
  paragraphId: z.string(),
  paragraph: z.number().int().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  anchorText: z.string(),
  kind: z.enum(['stress', 'pause', 'character_tag']),
  value: z.string(),
  nonSpaceStart: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  stale: z.boolean(),
  staleReason: z.enum(['text_changed', 'paragraph_missing']).optional(),
}) satisfies z.ZodType<PrepMarkupSpan>;

export const prepMarkupChapterSchema = z.object({
  chapterId: z.string(),
  spans: z.array(prepMarkupSpanSchema),
}) satisfies z.ZodType<PrepMarkupChapter>;
