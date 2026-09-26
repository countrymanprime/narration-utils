// The golden payloads for chapter stage recommendations: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import { z } from 'zod';
import { stageDecisionResultSchema, stageRecommendationsSchema } from '../schemas/stages';

export const stagesGoldens: Record<string, z.ZodType> = {
  'stages-recommendations-unknown.json': stageRecommendationsSchema,
  'stages-recommendations-recommended.json': stageRecommendationsSchema,
  'stages-recommendations-dismissed.json': stageRecommendationsSchema,
  'stages-recommendations-contradiction.json': stageRecommendationsSchema,
  'stages-recommendations-proofing.json': stageRecommendationsSchema,
  'stages-decision-confirmed.json': stageDecisionResultSchema,
  'stages-decision-refused.json': stageDecisionResultSchema,
  // Not payloads: the cause and refusal words the host can send, which the schema's lists must equal (the test below).
  'stages-causes.json': z.array(z.string()),
  'stages-refusal-reasons.json': z.array(z.string()),
};
