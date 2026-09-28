// The golden payloads for preview candidates: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { pinnedPreviewSchema, previewResultSchema } from '../schemas/preview';

export const previewGoldens: Record<string, z.ZodType> = {
  'preview-candidates-ok.json': previewResultSchema,
  'preview-candidates-no-manuscript.json': previewResultSchema,
  'preview-candidates-nothing-eligible.json': previewResultSchema,
  'preview-pin-none.json': pinnedPreviewSchema,
  'preview-pin-set.json': pinnedPreviewSchema,
  'preview-pin-stale-text-changed.json': pinnedPreviewSchema,
  'preview-pin-stale-paragraph-missing.json': pinnedPreviewSchema,
};
