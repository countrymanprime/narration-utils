// The golden payload for character-continuity-review.prd.md Phase 11 (D87 benches every acoustic-drift binding, so
// this is reference data only): which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { seriesVoiceBibleSchema } from '../schemas/series';

export const seriesGoldens: Record<string, z.ZodType> = {
  'series-voice-bible.json': seriesVoiceBibleSchema,
};
