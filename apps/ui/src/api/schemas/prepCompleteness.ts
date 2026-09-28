import { z } from 'zod';
import type { PrepCompletenessChapter, PrepCompletenessSummary, PrepCompletenessTotals } from '../contracts/prepCompleteness';

// The prep completeness rollup (apps/desktop/internal/prepcompleteness, apps/desktop/bindings_prepcompleteness.go),
// pinned against the host by tests/fixtures/contracts/prep-completeness-summary.json, which a Go test writes.

const prepCompletenessChapterSchema = z.object({
  chapterId: z.string(),
  title: z.string(),
  openQueries: z.number(),
  staleMarkupSpans: z.number(),
  complete: z.boolean(),
}) satisfies z.ZodType<PrepCompletenessChapter>;

const prepCompletenessTotalsSchema = z.object({
  chapters: z.number(),
  completeChapters: z.number(),
  openQueries: z.number(),
  staleMarkupSpans: z.number(),
  unattributedQueries: z.number(),
}) satisfies z.ZodType<PrepCompletenessTotals>;

export const prepCompletenessSummarySchema = z.object({
  chapters: z.array(prepCompletenessChapterSchema),
  totals: prepCompletenessTotalsSchema,
}) satisfies z.ZodType<PrepCompletenessSummary>;
