// The golden payloads for production tracking (production-tracking PRD Phase 3, apps/desktop/bindings_production.go).
import type { z } from 'zod';
import { productionPlanSchema } from '../schemas/production';

export const productionGoldens: Record<string, z.ZodType> = {
  'production-plan-empty.json': productionPlanSchema,
  'production-plan-set.json': productionPlanSchema,
};
