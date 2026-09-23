import type { WhisperInstallState, WhisperModel } from './whisper';

// Recording coverage (docs/utilities/recording-coverage.md, ADR 0129): a check of one chapter's saved recording
// against its manuscript text, run only when the narrator asks (Q14), and the stored result read back as current,
// stale or never. The host shapes are apps/desktop/bindings_coverage.go and apps/desktop/internal/coverage/view.go.

/** Why a chapter cannot be checked (or its result read) right now: nothing was run or written (coverage/reason.go). */
export type CoverageRefusalReason =
  | 'no_project'
  | 'no_project_file'
  | 'project_unreadable'
  | 'no_manuscript'
  | 'chapter_not_found'
  | 'not_narration'
  | 'unmapped'
  | 'multiple_tracks'
  | 'mapped_track_missing'
  | 'no_items'
  | 'unsupported_item'
  | 'source_missing'
  | 'item_unreadable'
  | 'busy'
  | 'sidecar_missing'
  | 'invalid_params'
  | 'manuscript_changed'
  | 'result_missing';

/** Why a stored result is stale or never, from the staleness evaluator (evidence/staleness.go). */
export type CoverageEvaluatorReason =
  | 'item_added'
  | 'item_removed'
  | 'item_trimmed'
  | 'item_moved'
  | 'item_muted'
  | 'take_switched'
  | 'source_changed'
  | 'analyzer_changed'
  | 'params_changed'
  | 'mapping_changed'
  | 'mapped_track_missing'
  | 'project_unreadable';

export type CoverageReason = CoverageRefusalReason | CoverageEvaluatorReason;

export type CoveragePhase = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

/** The one check the host runs at a time, or the last one that ended. Sent by CoverageState and the `coverage:state` event. */
export type CoverageState = {
  runId?: string;
  chapterId?: string;
  phase: CoveragePhase;
  /** Real progress from the sidecar (ADR 0015); it never moves backwards. */
  percent: number;
  stage?: string;
  message: string;
  /** The ledger record a finished run wrote. */
  recordId?: string;
  startedAt?: string;
  completedAt?: string;
};

export type CoverageStartResult =
  | { status: 'started'; state: CoverageState }
  | { status: 'refused'; reason: CoverageRefusalReason; message: string }
  | {
      status: 'asset_required';
      model: Omit<WhisperModel, 'downloadSize' | 'installState'>;
      installState: WhisperInstallState;
      downloadSize: number;
      diskSize: number;
      installPath: string;
    };

export type CoverageAlignment = { maxMisreadRun: number; minAnchorRun: number };

/** One played item of the chapter's track as the check treated it. */
export type CoverageItem = {
  index: number;
  itemGuid: string;
  status: 'analyzed' | 'muted';
  /** Whether the item's words were transcribed in that run or reused from the cache; absent for a muted item. */
  words?: 'transcribed' | 'reused';
  playedSeconds: number;
  wordCount: number;
  model?: string;
  language?: string;
};

export type CoverageParagraph = { id: string; tokens: number; present: number; longestMissingRun: number };

export type CoverageRegionKind = 'head' | 'tail' | 'skip' | 'short_read' | 'different_text';

/** Where missing text would sit in the audio. */
export type CoverageRegionPosition = { itemIndex: number; itemGuid: string; sourceTime: number };

export type CoverageRegion = {
  kind: CoverageRegionKind;
  paragraphIds: string[];
  tokenCount: number;
  firstWord: string;
  lastWord: string;
  position?: CoverageRegionPosition;
};

/** A stored report: counts, never a verdict (the thresholds are applied on read, Phase 7). */
export type CoverageReport = {
  model: string;
  language?: string;
  alignment: CoverageAlignment;
  bodyTokens: number;
  presentTokens: number;
  missingTokens: number;
  extraTokens: number;
  longestMissingRun: number;
  playedSeconds: number;
  items: CoverageItem[];
  paragraphs: CoverageParagraph[];
  regions: CoverageRegion[];
};

export type CoverageResult = {
  chapterId: string;
  state: 'current' | 'stale' | 'never';
  reasons: CoverageReason[];
  /** "saved project, file modified <time>" (Q8), and whether the saved file is older than the newest evidence or audio. */
  basis?: { label: string; modifiedAt: string; stale: boolean };
  record?: { id: string; outcome: 'complete' | 'partial' | 'failed'; startedAt: string; completedAt: string };
  /** The newest complete check's report, kept when it is stale so the narrator can see what changed since. */
  result?: CoverageReport;
  /** The share of the chapter's words present, only for a current result: the chapter payload's recordedFraction (D11). */
  recordedFraction?: number;
};

export interface CoverageApi {
  /** Starts a recording check of one chapter with the narrator's Transcript Compare model. */
  coverageStart(chapterId: string): Promise<CoverageStartResult>;
  coverageState(): Promise<CoverageState>;
  /** Asks a running check to stop; the items it finished stay cached. */
  coverageCancel(): Promise<void>;
  /** Reads a chapter's newest complete check back; never runs one. */
  coverageResult(chapterId: string): Promise<CoverageResult>;
  subscribeCoverage(onUpdate: (state: CoverageState) => void): () => void;
}
