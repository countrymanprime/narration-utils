// The golden payloads of the script markup layer (prep-depth.prd.md Phase 5, apps/desktop/bindings_prepmarkup.go).
import type { z } from 'zod';
import { prepMarkupChapterSchema, prepMarkupSpanSchema } from '../schemas/prepMarkup';

export const prepMarkupGoldens: Record<string, z.ZodType> = {
  'prep-markup-list-empty.json': prepMarkupChapterSchema,
  'prep-markup-list.json': prepMarkupChapterSchema,
  'prep-markup-list-stale.json': prepMarkupChapterSchema,
  'prep-markup-save.json': prepMarkupSpanSchema,
};
