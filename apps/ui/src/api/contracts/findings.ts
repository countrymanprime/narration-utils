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

/**
 * Whether the Review page's REAPER controls can work now (review dashboard Phase 7, apps/desktop/bindings_navigation.go),
 * read from the heartbeat REAPER's script already sends, so asking sends REAPER nothing. `standalone`: the app was opened
 * on its own; `not_running`: REAPER has gone quiet. `message` says so in plain words when not connected.
 */
export type ReaperConnection = 'connected' | 'not_running' | 'standalone';

export type ReaperStatus = {
  connection: ReaperConnection;
  message?: string;
  /** The finding a loop this app started is on, while connected; Stop puts the narrator's selection and repeat back. */
  loopingFindingId?: string;
};

/** Why REAPER was not asked, or did not move: the connection states, and what the finding or REAPER itself refused. */
export type FindingNavigationRefusal = 'standalone' | 'not_running' | 'no_item' | 'no_source_time' | 'stale' | 'recording' | 'script_outdated' | 'failed';

/**
 * What Go to, Loop or Stop did. Times are project seconds. A refusal changed nothing in REAPER, and `message` says why
 * and what to do in the narrator's words.
 */
export type FindingNavigation =
  | { outcome: 'navigated'; projectTime: number }
  | { outcome: 'looping'; loopStart: number; loopEnd: number }
  | { outcome: 'stopped'; restored: number; kept: number }
  | { outcome: 'refused'; reason: FindingNavigationRefusal; message: string };

/** Why no approved marker was added: the navigation refusals, and a finding the narrator has not accepted. */
export type FindingMarkerRefusal = FindingNavigationRefusal | 'not_accepted';

/**
 * What adding the approved marker did (review dashboard Phase 8, ADR 0123): `added` (REAPER added the take marker `name`, in
 * one undo point), `existing` (the take already had a marker of the same kind within 0.15 s, named `name`; nothing changed)
 * or `refused` (nothing in REAPER changed; `message` says why in the narrator's words). `sourceTime` is in the take's
 * source seconds.
 */
export type FindingMarker =
  { outcome: 'added' | 'existing'; name: string; sourceTime: number } | { outcome: 'refused'; reason: FindingMarkerRefusal; message: string };

export interface FindingsApi {
  /** One page of the findings that match the query, filtered, sorted and paged by the host. */
  findingsList(query: FindingsQuery): Promise<FindingsPage>;
  /** The finding with this id; rejects when the project no longer has it. */
  findingsGet(id: string): Promise<Finding>;
  /** Records the narrator's decision (append-only) and answers the finding as the host now holds it. */
  findingsReview(request: FindingReviewRequest): Promise<Finding>;
  /** Counts by status and the analyzers, categories and chapters present. */
  findingsSummary(): Promise<FindingsSummary>;
  /** Whether REAPER is there for Go to and Loop; sends REAPER nothing, so the page may poll it. */
  findingsReaperStatus(): Promise<ReaperStatus>;
  /** Selects the finding's item in REAPER and puts the edit cursor on its spot (ADR 0121). */
  findingsGoTo(id: string): Promise<FindingNavigation>;
  /** Loops the finding's context in REAPER: time selection, loop points, repeat on, Play (Q6). */
  findingsLoop(id: string): Promise<FindingNavigation>;
  /** Stops the loop and puts back the time selection, loop points and repeat the narrator had. */
  findingsStopLoop(): Promise<FindingNavigation>;
  /** Adds one take marker in REAPER at an accepted finding's spot, named like Transcript Compare's (ADR 0123). */
  findingsAddMarker(id: string): Promise<FindingMarker>;
}
