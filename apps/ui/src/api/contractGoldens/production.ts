// The golden payloads for production tracking: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { productionOverviewSchema, productionStartResultSchema, productionStopResultSchema } from '../schemas/production';

export const productionGoldens: Record<string, z.ZodType> = {
  'production-overview.json': productionOverviewSchema,
  'production-overview-empty.json': productionOverviewSchema,
  'production-timer-started.json': productionStartResultSchema,
  'production-timer-refused.json': productionStartResultSchema,
  'production-timer-stopped.json': productionStopResultSchema,
  'production-timer-stop-none.json': productionStopResultSchema,
};
