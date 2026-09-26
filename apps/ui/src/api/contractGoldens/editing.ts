// The golden payloads for editing readiness: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { editingCandidatesSchema, editingStartResultSchema, editingStateSchema } from '../schemas/editing';

export const editingGoldens: Record<string, z.ZodType> = {
  'editing-state-idle.json': editingStateSchema,
  'editing-start-refused-unmapped.json': editingStartResultSchema,
  'editing-candidates-empty.json': editingCandidatesSchema,
};
