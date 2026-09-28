// The golden payloads for production tracking: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import {
  productionBurndownSchema,
  productionOverviewSchema,
  productionPlanSchema,
  productionReportExportSchema,
  productionStartResultSchema,
  productionStopResultSchema,
} from '../schemas/production';

export const productionGoldens: Record<string, z.ZodType> = {
  // Phase 3: the plan (ProductionPlan, ProductionSetDeadline, ProductionSaveMilestones).
  'production-plan-empty.json': productionPlanSchema,
  'production-plan-set.json': productionPlanSchema,
  // Phase 4: the Production page's overview and the stage timer.
  'production-overview.json': productionOverviewSchema,
  'production-overview-empty.json': productionOverviewSchema,
  'production-timer-started.json': productionStartResultSchema,
  'production-timer-refused.json': productionStartResultSchema,
  'production-timer-stopped.json': productionStopResultSchema,
  'production-timer-stop-none.json': productionStopResultSchema,
  // Phase 5: the status report export (ProductionStatusReport).
  'production-status-report.json': productionReportExportSchema,
  // Phase 6: the burndown data (ProductionBurndown, Could).
  'production-burndown.json': productionBurndownSchema,
};
