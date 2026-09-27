/**
 * Production tracking (docs/prds/production-tracking.prd.md). Phase 3: the book's deadline, contracted amount and
 * milestones, stored on the project manifest (apps/desktop/bindings_production.go) so they survive Replace manuscript.
 * Dates are calendar dates written "YYYY-MM-DD" (ADR 0321), never a time of day.
 */

/** One dated checkpoint (Q5 A): the ACX 15-minute checkpoint is a milestone like any other. */
export type ProductionMilestone = { name: string; dueDate: string; note?: string };

/** The book's plan. `deadline` and `contractedAmount` are null when unset; `contractedAmount` is a bare number in the
 * narrator's own currency, never converted or formatted by the host. */
export type ProductionPlan = {
  deadline: string | null;
  contractedAmount: number | null;
  milestones: ProductionMilestone[];
};

export interface ProductionApi {
  /** Reads this project's deadline, contracted amount and milestones; an empty plan when none are set. */
  productionPlan(): Promise<ProductionPlan>;
  /** Sets the deadline ("YYYY-MM-DD", or "" to clear) and the contracted amount (null to clear); answers the whole plan.
   * An impossible date or a negative amount is refused and nothing is saved. */
  setProductionDeadline(deadline: string, contractedAmount: number | null): Promise<ProductionPlan>;
  /** Replaces the milestones, in this order; answers the whole plan. A milestone with no name or no real date refuses
   * the whole list and nothing is saved. */
  saveProductionMilestones(milestones: ProductionMilestone[]): Promise<ProductionPlan>;
}
