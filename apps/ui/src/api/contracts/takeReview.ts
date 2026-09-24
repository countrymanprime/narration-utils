// Take review (take-review-pickups-duplicates-take-intelligence.prd.md). Its pickup and duplicate_read findings are
// ordinary findings, read and decided through the Review page's generic bindings (FindingsApi, ADR 0120); what is its
// own is the reads a finding groups (its `evidence`, decoded on the page with takeReviewEvidenceSchema), the scan job
// that finds them, and the take-creation action. Evidence field names are the wire's own snake_case
// (docs/architecture/findings-contract.md). Q9: no composite score, so nothing here ranks one read over another.

import type { WorkJob } from './manuscript';
import type { MeasureClipRun, MeasureReport } from './measure';

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

/**
 * A take comparison (take review Phase 10, ADR 0165): a `take_comparison` finding whose `evidence` sets the reads of one
 * take-review group side by side over the group's one span of the script. Each read is compared or says why not; a compared one
 * has how it read every word of the span (from the sidecar's --take-divergence mode, ADR 0141) and its audio measurements, one
 * category each, measured or unavailable with a reason (ADR 0140). Nothing adds the categories up or orders the reads (Q9).
 */
export type TakeComparisonWordStatus = 'matched' | 'misread' | 'skipped' | 'unread';

export type TakeComparisonSpanWord = { index: number; text: string; unit: number; paragraph: number };

/** How a read read one word of the span; `start`/`end` are seconds in its source file, null when it has no time for it. */
export type TakeComparisonWord = { index: number; status: TakeComparisonWordStatus; start: number | null; end: number | null };

/** One place a read departs from the script: span words `first_word`..`last_word` and the seconds of its source it occupies. */
export type TakeComparisonDivergence = {
  kind: string;
  position: string;
  first_word: number | null;
  last_word: number | null;
  manuscript_text: string;
  audio_text: string;
  start: number | null;
  end: number | null;
};

export type TakeComparisonCounts = { matched: number; misread: number; skipped: number; unread: number; extra_words: number };

/** A category's availability: `measured`, or `unavailable` with the reason (never a guessed value, ADR 0025). */
export type TakeMetricStatus = { status: 'measured' | 'unavailable'; reason?: string };

/** A run of three or more full-scale samples on one channel, timed from the start of the measured range. */
export type TakeClipRun = MeasureClipRun;

/** The range measurement every audio figure comes from (internal/measure.Report), kept so each figure can be reproduced. */
export type TakeAudioReport = MeasureReport;

export type TakeMetrics = {
  take_guid: string;
  take_index: number;
  /** The part of its source file the take plays; null when it cannot be derived. */
  source: { file: string; kind: string; range: { start_seconds: number; length_seconds: number } } | null;
  audio: TakeAudioReport | null;
  clipping: TakeMetricStatus & { full_scale_samples: number | null; clip_run_count: number | null; clip_runs: TakeClipRun[] };
  noise: TakeMetricStatus & { noise_floor_dbfs: number | null; digital_silent_windows: number | null };
  level_consistency: TakeMetricStatus & {
    integrated_lufs: number | null;
    neighbor_median_lufs: number | null;
    delta_lu: number | null;
    neighbors_measured: number;
    neighbors_unavailable: number;
  };
  duration: TakeMetricStatus & {
    item_seconds: number | null;
    source_seconds: number | null;
    audio_seconds: number | null;
    speech_seconds: number | null;
    words_per_minute: number | null;
  };
  pause_profile: TakeMetricStatus & {
    min_pause_seconds: number;
    long_pause_seconds: number;
    count?: number;
    total_seconds?: number;
    longest_seconds?: number;
    median_seconds?: number;
    long_pauses?: Array<{ start_seconds: number; duration_seconds: number }>;
    leading_seconds?: number;
    trailing_seconds?: number | null;
  };
  coverage: { measured: number; total: number; unavailable: string[] };
};

/** One read of the group in the comparison, in the group's order, so Go to and Loop by index reach the same take. */
export type TakeComparisonMember = {
  item_guid: string;
  take_guid: string;
  source_file: string;
  source_start: number;
  source_length: number;
  compared: boolean;
  not_compared_reason?: string;
  fidelity: number | null;
  counts: TakeComparisonCounts | null;
  words: TakeComparisonWord[];
  divergences: TakeComparisonDivergence[];
  metrics: TakeMetrics | null;
};

export type TakeComparisonEvidence = {
  source_finding_id: string;
  span: { first_unit: number; last_unit: number; words: TakeComparisonSpanWord[] };
  model: string;
  compared: number;
  members: TakeComparisonMember[];
};

/** The comparison job (TakeComparisonStart/State/Cancel): the group it compares, and the comparison it saved when it succeeded. */
export type TakeComparisonJob = Omit<WorkJob, 'kind' | 'phase' | 'preview' | 'requiresReset' | 'result' | 'detail'> & {
  kind: 'take_comparison';
  phase: 'idle' | 'running' | 'success' | 'cancelled' | 'error';
  findingId: string;
  comparisonId?: string;
};

export interface TakeReviewApi {
  /** Compares the takes of the take-review group `findingId` as a job; rejects a finding that is not a comparable group, or while one runs. */
  takeComparisonStart(findingId: string): Promise<TakeComparisonJob>;
  /** The comparison job: idle, running with real progress, or how it ended (with the comparison's finding id). */
  takeComparisonState(): Promise<TakeComparisonJob>;
  /** Stops a running comparison; nothing is saved. Answers the job. */
  takeComparisonCancel(): Promise<TakeComparisonJob>;
  /** Starts a pickup and duplicate scan of `scope` as a job; rejects a scope it cannot scan, or while a scan runs. */
  takeReviewScanStart(scope: TakeReviewScanScope): Promise<TakeReviewScanJob>;
  /** The scan job: idle (offering the project's saved pickup scope), running with real progress, or how it ended. */
  takeReviewScanState(): Promise<TakeReviewScanJob>;
  /** Stops a running scan; nothing it found is saved. Answers the job. */
  takeReviewScanCancel(): Promise<TakeReviewScanJob>;
  /** Adds a narrator-approved candidate's source range as a new take on the target item (phase 6, confirmed and undoable). */
  takeReviewCreateTake(request: TakeReviewCreateTakeRequest): Promise<TakeReviewCreateTakeResult>;
}
