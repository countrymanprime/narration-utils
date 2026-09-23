// The take-review pickup/duplicate scan's findings, as TakeReviewScan and TakeReviewFindings send
// them (apps/desktop/internal/findings.Finding, produced by internal/repeats.ToFindings). Field
// names are the wire's own snake_case (docs/architecture/findings-contract.md), not renamed to
// camelCase: this is the shared, documented findings contract boundary, not a binding this app
// controls end to end. Q9 of take-review-pickups-duplicates-take-intelligence.prd.md: no
// composite score, per-category evidence only, so this type carries no ranking field at all.

export type TakeReviewProject = {
  path: string;
  output_path?: string;
};

export type TakeReviewSource = {
  file: string;
  track_guid?: string;
  item_guid?: string;
  take_guid?: string;
};

export type TakeReviewTimeRange = {
  start: number;
  end: number;
  source_start?: number;
  source_end?: number;
};

export type TakeReviewSpan = {
  paragraph_id?: string;
  start?: number;
  end?: number;
  ordinal?: number;
};

export type TakeReviewManuscript = {
  chapter_id?: string;
  chapter_title?: string;
  expected?: string;
  recorded?: string;
  span?: TakeReviewSpan;
};

/** One read the sidecar clustered into this finding's group (internal/repeats.Member). */
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

/** internal/repeats.classify's evidence.kind: "exact_copy" | "restart" | "pickup" | "near_duplicate". */
export type TakeReviewEvidence = {
  kind: string;
  matched_span_first: number;
  matched_span_last: number;
  members: TakeReviewMember[];
};

export type TakeReviewSuggestedAction = {
  kind: string;
  parameters?: Record<string, unknown>;
  requires_confirmation: boolean;
};

export type TakeReviewReviewState = {
  status: string;
  note?: string;
  timestamp?: string;
};

export type TakeReviewFinding = {
  schema_version: number;
  id: string;
  analyzer: string;
  project: TakeReviewProject;
  source: TakeReviewSource;
  time_range?: TakeReviewTimeRange;
  manuscript?: TakeReviewManuscript;
  category: string;
  severity: string;
  /** Nullable: confidence in the grouping itself, never a composite ranking of which take is better (Q9). */
  confidence: number | null;
  evidence_version?: string;
  confidence_reason: string;
  evidence?: TakeReviewEvidence;
  suggested_action?: TakeReviewSuggestedAction;
  review: TakeReviewReviewState;
  not_in_latest_run?: boolean;
};

/**
 * What TakeReviewCreateTake needs to attach a narrator-approved candidate's source range as a new
 * take on the target item (take-review phase 6): the finding it came from (provenance, ADR 0098),
 * the target item the narrator explicitly chose (Q4/Q6 - never preselected on a weak match), the
 * candidate's own item GUID when it has one (an extra staleness check the Lua command re-resolves;
 * empty skips it), its source file, and the matched span's range within that source (seconds,
 * source-file-relative - sourceRangeStart becomes the new take's D_STARTOFFS).
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
  /** Runs one pickup/duplicate scan of chapterTrackName's items and takes and saves the fresh findings. */
  takeReviewScan(chapterTrackName: string): Promise<TakeReviewFinding[]>;
  /** Reads the take-review analyzer's saved findings for chapterTrackName without running a new scan. */
  takeReviewFindings(chapterTrackName: string): Promise<TakeReviewFinding[]>;
  /** Adds a narrator-approved candidate's source range as a new take on the target item (phase 6, confirmed and undoable). */
  takeReviewCreateTake(request: TakeReviewCreateTakeRequest): Promise<TakeReviewCreateTakeResult>;
}
