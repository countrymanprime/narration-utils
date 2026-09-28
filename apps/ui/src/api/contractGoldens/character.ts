// The golden payloads for character-continuity-review.prd.md Phase 6 (non-acoustic part only; D87 on #509 benches
// every acoustic-drift binding): which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { approvedCharacterReferencesSchema, characterRegionsSchema, characterReferenceSchema } from '../schemas/character';

export const characterGoldens: Record<string, z.ZodType> = {
  'character-regions.json': characterRegionsSchema,
  'character-approve.json': characterReferenceSchema,
  'character-references.json': approvedCharacterReferencesSchema,
};
