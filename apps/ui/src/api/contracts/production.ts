import type { ChapterStatus, ManuscriptContentKind, RecordedUnavailable } from './manuscript';
import type { StageVerdict } from './stages';

/**
 * Production tracking (the PRD, delivered and deleted; ADR 0028). Phase 3: the book's deadline, contracted amount and
 * milestones, stored on the project manifest (apps/desktop/bindings_production.go) so they survive Replace manuscript.
 * Dates are calendar dates written "YYYY-MM-DD" (ADR 0323), never a time of day.
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

// Phase 4: the Production page's one read and the stage timer's two
// writes. The host shapes are apps/desktop/internal/production (overview.go, production.go) and apps/desktop/bindings_production.go.
// Every figure here is measured or logged, never estimated (ADR 0320): an undefined one is `null`, shown as "—", never 0.

/** One stretch of work on one chapter's stage. `endedAt` is absent while its timer runs. `source` is always `manual` (Q1 A). */
export type ProductionSession = {
  id: string;
  chapterId: string;
  stage: ChapterStatus;
  startedAt: string;
  endedAt?: string;
  source: string;
};

/**
 * A chapter's current-stage verdict as the stage recommendations gave it, read and never recomputed (Q8 A). `reason` is the first
 * signal that holds the stage back, or with none the first unknown one; empty otherwise.
 */
export type ProductionReadiness = {
  verdict: StageVerdict;
  target?: ChapterStatus;
  reason: string;
};

/** One row of the board. `recordedSeconds` is the measured length of its confirmed track, `null` with `recordedUnavailable` saying why. */
export type ProductionChapter = {
  id: string;
  title: string;
  subtitle?: string;
  contentKind: ManuscriptContentKind | '';
  status: ChapterStatus;
  wordCount: number;
  recordedSeconds: number | null;
  recordedUnavailable?: RecordedUnavailable;
  hoursLogged: number;
  /** Hours logged on the chapter per finished hour of it; `null` with no measured audio or no logged time. */
  pfh: number | null;
  /** `null` for a chapter the stage recommendations did not assess (not narration, or they could not be read). */
  readiness: ProductionReadiness | null;
};

/** The KPI row's book-wide figures. */
export type ProductionTotals = {
  chapters: number;
  finalizedChapters: number;
  wordCount: number;
  /** Every chapter's measured recorded seconds added up; unmeasured chapters add nothing. */
  recordedSeconds: number;
  measuredChapters: number;
  hoursLogged: number;
  /** Hours logged per stage; a stage with none is absent. */
  hoursByStage: Partial<Record<ChapterStatus, number>>;
  bookPfh: number | null;
  /** The plan's contracted amount (Phase 3); `null` until set. */
  contractedAmount: number | null;
  effectiveRate: number | null;
};

/** The book's due date (`YYYY-MM-DD`) and the whole days left until it, negative once passed. */
export type ProductionDeadline = { date: string; daysLeft: number };

/** One chapter "Next up" lists, in the host's order (ADR 0404). */
export type ProductionNextUpItem = {
  chapterId: string;
  title: string;
  subtitle?: string;
  stage: ChapterStatus;
  readiness: ProductionReadiness | null;
};

export type ProductionOverview = {
  chapters: ProductionChapter[];
  totals: ProductionTotals;
  /** The plan's deadline (Phase 3) with the days left; `null` until one is set. */
  deadline: ProductionDeadline | null;
  running: ProductionSession | null;
  nextUp: ProductionNextUpItem[];
};

export type ProductionStartResult =
  | { status: 'started'; session: ProductionSession }
  /** Another timer is running: it is stopped first, never switched silently. */
  | { status: 'refused'; reason: 'timer_running'; message: string };

export type ProductionStopResult = { stopped: true; session: ProductionSession } | { stopped: false; session: null };

/**
 * What one status report export wrote (ProductionStatusReport, production-tracking.prd.md Phase 5): the folder
 * relative to the project (`narration-utils/production/reports`), the two file names in it, and whether the narrator
 * chose to include the contracted amount and effective rate (off by default: a status report is often shared with
 * someone the narrator would not otherwise tell their rate).
 */
export type ProductionReportExport = {
  folder: string;
  htmlFile: string;
  jsonFile: string;
  contractedAmountIncluded: boolean;
};

/**
 * One calendar date of the book's logged-hours burndown (ProductionBurndown, production-tracking.prd.md Phase 6,
 * Could): every hour logged by the end of that day, added up from every earlier day. Data only - a future chart
 * primitive (out of this PRD's scope) would plot it.
 */
export type ProductionBurndownPoint = { date: string; hoursLogged: number };

export interface ProductionApi {
  /** Reads this project's deadline, contracted amount and milestones; an empty plan when none are set. */
  productionPlan(): Promise<ProductionPlan>;
  /** Sets the deadline ("YYYY-MM-DD", or "" to clear) and the contracted amount (null to clear); answers the whole plan.
   * An impossible date or a negative amount is refused and nothing is saved. */
  setProductionDeadline(deadline: string, contractedAmount: number | null): Promise<ProductionPlan>;
  /** Replaces the milestones, in this order; answers the whole plan. A milestone with no name or no real date refuses
   * the whole list and nothing is saved. */
  saveProductionMilestones(milestones: ProductionMilestone[]): Promise<ProductionPlan>;
  /** The Production page's board, KPI figures and "Next up" list. Reads only; never changes a chapter status. */
  productionOverview(): Promise<ProductionOverview>;
  /** Starts a timer on the chapter's stage; refused while another timer runs. */
  productionStartTimer(chapterId: string, stage: ChapterStatus): Promise<ProductionStartResult>;
  /** Stops the running timer; a no-op (`stopped: false`) when none runs. */
  productionStopTimer(): Promise<ProductionStopResult>;
  /**
   * Writes an HTML and a JSON status report (hours by stage, PFH, the deadline and milestone status, and book-wide
   * readiness counts) into the project's sidecar folder, from exactly the same figures `productionOverview` just
   * answered. `includeContractedAmount` writes the contracted amount and effective rate; off by default. Rejects
   * without a project.
   */
  productionStatusReport(includeContractedAmount: boolean): Promise<ProductionReportExport>;
  /** The book's logged hours by day, one point per day from the first stopped session to the last; empty until one
   * is logged. Data only, for a future chart primitive (out of this PRD's scope). */
  productionBurndown(): Promise<ProductionBurndownPoint[]>;
}
