// The review bindings (review-dashboard-and-findings-adoption.prd.md Phase 4, ADR 0120): every analyzer's
// findings, read and decided through one surface whatever wrote them. A Finding keeps the wire's own snake_case
// (docs/architecture/findings-contract.md, apps/desktop/internal/findings.Finding); the binding envelopes around
// it (the query, the page, the summary) are camelCase like every other binding. Filtering, sorting and paging run
// in the host (Q9): the UI sends a FindingsQuery and shows the page it gets back.

export type FindingSeverity = 'info' | 'warning' | 'error';

/** Every category the contract documents, in its order (findings.Categories(), apps/desktop/internal/findings/findings.go). */
export const FINDING_CATEGORIES = [
  'transcript_discrepancy',
  'pronunciation',
  'entity',
  'pickup',
  'duplicate_read',
  'take_comparison',
  'character_continuity',
  'pacing',
  'audio_quality',
  'delivery_qc',
  'silence_cleanup',
  'level_consistency',
] as const;

/** The longest note a decision may carry, in characters (maxReviewNoteRunes, apps/desktop/bindings_findings.go). */
export const MAX_REVIEW_NOTE_LENGTH = 2000;

export type FindingReviewStatus = 'unreviewed' | 'accepted' | 'dismissed' | 'deferred';

/** Each key's natural order, which `descending` reverses; a finding with no value for the key sorts last either way. */
export type FindingSortKey =
  /** Chapter id, A to Z (the default). */
  | 'chapter'
  /** time_range.start, earliest first. */
  | 'time'
  /** Confidence, lowest (least certain) first. */
  | 'confidence'
  /** Severity, error first. */
  | 'severity';

export type FindingProject = {
  path?: string;
  output_path?: string;
};

/** REAPER GUIDs are preferred for navigation; time_range is only the stale-project fallback. */
export type FindingSource = {
  file?: string;
  track_guid?: string;
  item_guid?: string;
  take_guid?: string;
};

/** Project seconds, and the same window as source-file-relative offsets when the analyzer has them. */
export type FindingTimeRange = {
  start: number;
  end: number;
  source_start?: number;
  source_end?: number;
};

export type FindingSpan = {
  paragraph_id?: string;
  start?: number;
  end?: number;
  ordinal?: number;
};

export type FindingManuscript = {
  chapter_id?: string;
  chapter_title?: string;
  expected?: string;
  recorded?: string;
  span?: FindingSpan;
};

/** A proposal only: the host executes it after the narrator confirms, never on its own. */
export type FindingSuggestedAction = {
  kind: string;
  parameters?: Record<string, unknown>;
  requires_confirmation: boolean;
};

export type FindingReviewState = {
  status: FindingReviewStatus;
  note?: string;
  timestamp?: string;
};

export type Finding = {
  schema_version: number;
  id: string;
  /** The store partition that wrote it: "transcript-compare", "story-bible", "take-review", and later analyzers. */
  analyzer: string;
  project: FindingProject;
  source: FindingSource;
  time_range?: FindingTimeRange;
  manuscript?: FindingManuscript;
  /** One of the contract's categories (transcript_discrepancy, entity, pronunciation, pickup, ...); open so a newer host still loads. */
  category: string;
  severity: FindingSeverity;
  /** Null when the analyzer has no numeric score; confidence_reason explains either way. */
  confidence: number | null;
  confidence_reason: string;
  /** Hashes the evidence a decision is made against; FindingsReview sends back the one the page showed. */
  evidence_version?: string;
  /** Analyzer-specific: each analyzer documents its own keys (findings-contract.md). */
  evidence?: Record<string, unknown>;
  suggested_action?: FindingSuggestedAction;
  review: FindingReviewState;
  /** The latest run did not reproduce it; kept for audit rather than deleted. */
  not_in_latest_run?: boolean;
};

/** Every field optional: an empty filter matches everything, no sort is chapter order, no limit is every match. */
export type FindingsQuery = {
  analyzer?: string;
  category?: string;
  severity?: FindingSeverity;
  status?: FindingReviewStatus;
  chapterId?: string;
  minConfidence?: number;
  includeNotInLatestRun?: boolean;
  sort?: FindingSortKey;
  descending?: boolean;
  limit?: number;
  offset?: number;
};

/** One page of the sorted matches, and how many matched before paging. */
export type FindingsPage = {
  findings: Finding[];
  total: number;
};

export type FindingChapterFacet = {
  id: string;
  title?: string;
};

/** The queue at a glance: the latest run's findings by status (the navigation badge is `unreviewed`) and the facets present. */
export type FindingsSummary = {
  total: number;
  unreviewed: number;
  accepted: number;
  dismissed: number;
  deferred: number;
  notInLatestRun: number;
  analyzers: string[];
  categories: string[];
  chapters: FindingChapterFacet[];
};

/** A decision on the finding the page showed; the host refuses it when the evidence changed since (ADR 0120). */
export type FindingReviewRequest = {
  id: string;
  evidenceVersion: string;
  status: FindingReviewStatus;
  note: string;
};

export interface FindingsApi {
  /** One page of the findings that match the query, filtered, sorted and paged by the host. */
  findingsList(query: FindingsQuery): Promise<FindingsPage>;
  /** The finding with this id; rejects when the project no longer has it. */
  findingsGet(id: string): Promise<Finding>;
  /** Records the narrator's decision (append-only) and answers the finding as the host now holds it. */
  findingsReview(request: FindingReviewRequest): Promise<Finding>;
  /** Counts by status and the analyzers, categories and chapters present. */
  findingsSummary(): Promise<FindingsSummary>;
}
