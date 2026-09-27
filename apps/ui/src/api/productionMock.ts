// The browser mock's production plan (production-tracking PRD Phase 3), answering the shape
// apps/desktop/bindings_production.go's ProductionPlan, ProductionSetDeadline and ProductionSaveMilestones do, with the
// same refusals (internal/production/plan.go): an impossible date, a negative amount, a milestone with no name.
import type { ProductionApi, ProductionMilestone, ProductionPlan } from '../types';

export type ProductionSeed = Partial<ProductionPlan>;

function checkDate(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !date || date.toISOString().slice(0, 10) !== trimmed) throw new Error(`"${trimmed}" is not a date written YYYY-MM-DD`);
  return trimmed;
}

function copy(plan: ProductionPlan): ProductionPlan {
  return { ...plan, milestones: plan.milestones.map((milestone) => ({ ...milestone })) };
}

export function createProductionMock(seed: ProductionSeed = {}): ProductionApi {
  let plan: ProductionPlan = copy({ deadline: seed.deadline ?? null, contractedAmount: seed.contractedAmount ?? null, milestones: seed.milestones ?? [] });
  return {
    productionPlan: async () => copy(plan),
    setProductionDeadline: async (deadline, contractedAmount) => {
      const checked = deadline === '' ? null : checkDate(deadline);
      if (contractedAmount !== null && !(Number.isFinite(contractedAmount) && contractedAmount >= 0)) {
        throw new Error('the contracted amount must be a number of zero or more');
      }
      plan = { ...plan, deadline: checked, contractedAmount };
      return copy(plan);
    },
    saveProductionMilestones: async (milestones) => {
      const cleaned: ProductionMilestone[] = milestones.map((milestone, index) => {
        const name = milestone.name.trim();
        if (!name) throw new Error(`milestone ${index + 1} needs a name`);
        const note = milestone.note?.trim();
        return { name, dueDate: checkDate(milestone.dueDate), ...(note ? { note } : {}) };
      });
      plan = { ...plan, milestones: cleaned };
      return copy(plan);
    },
  };
}
