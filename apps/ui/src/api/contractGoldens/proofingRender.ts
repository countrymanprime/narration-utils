// The golden payloads for a chapter's render association (proofing-readiness-signals.prd.md Phase 6): which schema
// owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { proofingChooseRenderResultSchema, proofingRenderSchema } from '../schemas/proofingRender';

export const proofingRenderGoldens: Record<string, z.ZodType> = {
  'proofing-render-none.json': proofingRenderSchema,
  'proofing-render-current-unmeasured.json': proofingRenderSchema,
  'proofing-render-current-measured.json': proofingRenderSchema,
  'proofing-render-current-measurement-failed.json': proofingRenderSchema,
  'proofing-render-stale.json': proofingRenderSchema,
  'proofing-render-missing.json': proofingRenderSchema,
  'proofing-render-unsupported.json': proofingRenderSchema,
  'proofing-choose-render-cancelled.json': proofingChooseRenderResultSchema,
  'proofing-choose-render-refused.json': proofingChooseRenderResultSchema,
};
