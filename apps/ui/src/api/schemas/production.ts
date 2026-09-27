import { z } from 'zod';
import type { ProductionMilestone, ProductionPlan } from '../contracts/production';
import { listFromNull } from './base';

// The production plan payload (apps/ui/src/api/contracts/production.ts). The host shape is production.Plan
// (apps/desktop/internal/production/plan.go), answered by apps/desktop/bindings_production.go.

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const productionMilestoneSchema = z.object({
  name: z.string(),
  dueDate: calendarDate,
  note: z.string().optional(),
}) satisfies z.ZodType<ProductionMilestone>;

export const productionPlanSchema = z.object({
  deadline: calendarDate.nullable(),
  contractedAmount: z.number().nonnegative().nullable(),
  milestones: listFromNull(productionMilestoneSchema),
}) satisfies z.ZodType<ProductionPlan>;
