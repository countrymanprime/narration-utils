// The golden payloads for recording coverage: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import { z } from 'zod';
import { coverageResultSchema, coverageStartResultSchema, coverageStateSchema } from '../schemas/coverage';

export const coverageGoldens: Record<string, z.ZodType> = {
  'coverage-result-current.json': coverageResultSchema,
  'coverage-result-stale.json': coverageResultSchema,
  'coverage-result-never.json': coverageResultSchema,
  'coverage-result-unmapped.json': coverageResultSchema,
  'coverage-start-started.json': coverageStartResultSchema,
  'coverage-start-refused.json': coverageStartResultSchema,
  'coverage-state-idle.json': coverageStateSchema,
  'coverage-state-complete.json': coverageStateSchema,
  // Not a payload: the reason words the host can send, which the schema's lists must equal (the test below).
  'coverage-reasons.json': z.object({ refusal: z.array(z.string()), evaluator: z.array(z.string()) }),
};
