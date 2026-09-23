// Take review (take-review-pickups-duplicates-take-intelligence.prd.md). Its pickup and duplicate_read findings are
// ordinary findings, read and decided through the Review page's generic bindings (FindingsApi, ADR 0120); what is its
// own is the reads a finding groups (its `evidence`, decoded on the page with takeReviewEvidenceSchema), the scan job
// that finds them, and the take-creation action. Evidence field names are the wire's own snake_case
// (docs/architecture/findings-contract.md). Q9: no composite score, so nothing here ranks one read over another.

import type { WorkJob } from './manuscript';

/** One read the sidecar grouped into a finding (internal/repeats.Member): an item, or one take of an item. */
export type TakeReviewMember = {
  item_index: number;
  item_guid: string;
  take_guid: string;
  source_file: string;
  source_start: number;
  source_length: number;
  /** Fraction of the group's manuscript span this read covers: 1 is a full re-read, less is a partial pickup. */
  coverage: number;
  /** Fraction of aligned tokens that matched the manuscript exactly. */
  quality: number;
  exact_copy_group: string;
};

/** A take-review finding's `evidence`; `kind` is internal/repeats.classify's "exact_copy" | "restart" | "pickup" | "near_duplicate". */
export type TakeReviewEvidence = {
  kind: string;
  matched_span_first: number;
  matched_span_last: number;
  members: TakeReviewMember[];
};

/**
 * What a scan covers (Q3): a chapter track's items and all their takes, plus at most one pickup addition, a pickup track or
 * a time range in project seconds. The idle job carries the project's saved pickup addition with no chapter track, to offer.
 */
export type TakeReviewScanScope = {
  chapterTrackName: string;
  pickupTrackName?: string;
  pickupRangeStart?: number;
  pickupRangeEnd?: number;
};

/**
 * The scan job (TakeReviewScanStart/State/Cancel), in the shape of the host's other jobs so WorkDialog shows it: the
 * sidecar's own percent and stage (ADR 0015), the scope it runs on, and how many groups of repeated reads it saved.
 */
export type TakeReviewScanJob = Omit<WorkJob, 'kind' | 'phase' | 'preview' | 'requiresReset' | 'result' | 'detail'> & {
  kind: 'take_review';
  phase: 'idle' | 'running' | 'success' | 'cancelled' | 'error';
  scope: TakeReviewScanScope;
  found: number;
};

/**
 * What TakeReviewCreateTake needs to attach a narrator-approved candidate's source range as a new take on the target item
 * (take-review phase 6): the finding it came from (provenance, ADR 0098), the target item the narrator explicitly chose
 * (Q4/Q6: never preselected), the candidate's own item GUID when it has one (an extra staleness check the Lua command
 * re-resolves; empty skips it), its source file, and the matched span's range within that source (seconds,
 * source-file-relative: sourceRangeStart becomes the new take's D_STARTOFFS).
 */
export type TakeReviewCreateTakeRequest = {
  findingId: string;
  targetItemGuid: string;
  candidateItemGuid: string;
  sourceFile: string;
  sourceRangeStart: number;
  sourceRangeEnd: number;
};

/** What TakeReviewCreateTake sends back once REAPER confirms the take exists (both re-resolved by GUID). */
export type TakeReviewCreateTakeResult = {
  targetItemGuid: string;
  newTakeGuid: string;
};

export interface TakeReviewApi {
  /** Starts a pickup and duplicate scan of `scope` as a job; rejects a scope it cannot scan, or while a scan runs. */
  takeReviewScanStart(scope: TakeReviewScanScope): Promise<TakeReviewScanJob>;
  /** The scan job: idle (offering the project's saved pickup scope), running with real progress, or how it ended. */
  takeReviewScanState(): Promise<TakeReviewScanJob>;
  /** Stops a running scan; nothing it found is saved. Answers the job. */
  takeReviewScanCancel(): Promise<TakeReviewScanJob>;
  /** Adds a narrator-approved candidate's source range as a new take on the target item (phase 6, confirmed and undoable). */
  takeReviewCreateTake(request: TakeReviewCreateTakeRequest): Promise<TakeReviewCreateTakeResult>;
}
