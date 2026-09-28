import type { CoverageReason } from './coverage';
import type { FindingNavigation } from './findings';

// The edit-and-proof workspace's stored word alignment (edit-and-proof-workspace.prd.md Phase 1, ADR 0242): the
// recording check's per-token alignment (COVERAGE_TOKEN/COVERAGE_EXTRA, sidecars/transcript-compare) read back and
// joined with the chapter's paragraphs and its items' current played ranges. The host shapes are
// apps/desktop/internal/coverage/{alignment.go,workspace.go} and apps/desktop/bindings_coverage.go's
// WorkspaceAlignment. Read-only: it never runs a check (Q14 of the recording-coverage PRD).

/** One chapter token as the check aligned it: `read` and `misread` are present, the rest are missing (a region kind)
 * or the optional heading. Item, start and end name where it was heard (source seconds), set only when something
 * was; heard is the misread word actually said. */
export type WorkspaceToken = {
  /** The token's position in the chapter, in order (kept short on the wire: a chapter has thousands of these). */
  i: number;
  /** The paragraph this token belongs to; absent for a title or subtitle token. */
  p?: string;
  /** The ordinal of this token's whitespace word in its paragraph's (or the heading's) text. */
  w: number;
  text: string;
  status: 'read' | 'misread' | 'heading' | 'head' | 'tail' | 'skip' | 'short_read' | 'different_text';
  heard?: string;
  item?: number;
  start?: number;
  end?: number;
};

/** A point in the audio: an item and a time in its source file (as coverage's RegionPosition). */
export type WorkspaceAudioPosition = { itemIndex: number; itemGuid: string; sourceTime: number };

/** One run of transcript words the chapter's tokens do not account for (a retake, a false start, an aside).
 * afterToken is the doc token index of the last token heard before this run, absent before anything was heard. */
export type WorkspaceExtra = {
  text: string;
  tokens: number;
  start: WorkspaceAudioPosition;
  end: WorkspaceAudioPosition;
  afterToken?: number;
};

export type WorkspaceParagraph = { id: string; text: string };

/** One manifest item's current played range, joined by item GUID against the saved project (tracks.Item's
 * edit-and-proof-workspace Phase 1 fields). live is false when the saved project no longer has an item with this
 * GUID: the other fields are then absent. */
export type WorkspaceItem = {
  index: number;
  itemGuid: string;
  live: boolean;
  takeGuid?: string;
  sourceStart?: number;
  playRate?: number;
  position?: number;
  length?: number;
};

export type WorkspaceAlignmentResult = {
  chapterId: string;
  /** Shared with CoverageResult: an alignment is only ever as current as the coverage result it was written with. */
  state: 'current' | 'stale' | 'never';
  reasons: CoverageReason[];
  basis?: { label: string; modifiedAt: string; stale: boolean };
  /** True when the newest current or stale result has no stored alignment yet (a report from before the sidecar
   * wrote COVERAGE_TOKEN lines): align-again re-aligns it from cached words alone, without running the check. */
  needsAlignAgain: boolean;
  paragraphs: WorkspaceParagraph[];
  tokens: WorkspaceToken[];
  extras: WorkspaceExtra[];
  items: WorkspaceItem[];
};

/** A waveform overview of a stretch of a WAV source (measure.Peaks, edit-and-proof-workspace.prd.md Phase 5, ADR
 * 0520): for each bucket of 1/bucketsPerSecond seconds, the lowest and highest sample over every channel, as two
 * signed bytes scaled to +-127 packed into minMax (base64: buckets * 2 bytes, minimum then maximum per bucket). */
export type WorkspacePeaks = {
  startSeconds: number;
  bucketsPerSecond: number;
  buckets: number;
  minMax: string;
  sampleRate: number;
  channels: number;
};

/** One analyzed item's waveform, or why it has none (WorkspacePeaksItem, apps/desktop/bindings_workspace_peaks.go):
 * peaks is absent, and reason set, for an item that is not live, has no source audio, or whose source is not a WAV
 * ("no waveform" per EP12 A) - never an error, so one bad item does not blank the rest of the strip. */
export type WorkspacePeaksEntry = { index: number; peaks?: WorkspacePeaks; reason?: string };

export type WorkspacePeaksResult = { chapterId: string; items: WorkspacePeaksEntry[] };

export interface WorkspaceApi {
  /** Reads a chapter's stored word alignment joined with its paragraphs and items' current played ranges. Never
   * runs anything. */
  workspaceAlignment(chapterId: string): Promise<WorkspaceAlignmentResult>;
  /** Selects tokenIndex's item in REAPER and puts the edit cursor on the spot it was heard (edit-and-proof-workspace
   * PRD Phase 3): navigate_item, resolved from the token's item, take and source time in the host, exactly as
   * findingsGoTo does for a finding. Connection status is shared with the Review page (findingsReaperStatus). */
  workspaceGoTo(chapterId: string, tokenIndex: number): Promise<FindingNavigation>;
  /** Loops the chapter passage from firstToken to lastToken (inclusive, both heard on the same item) in REAPER, as
   * findingsLoop does for a finding. findingsStopLoop stops it: the workspace holds no loop state of its own. */
  workspaceLoop(chapterId: string, firstToken: number, lastToken: number): Promise<FindingNavigation>;
  /** Reads the waveform strip's peaks for every analyzed item of a chapter's stored alignment (edit-and-proof-
   * workspace PRD Phase 5): host-computed from each item's active take's source file, cached by source identity. */
  workspacePeaks(chapterId: string): Promise<WorkspacePeaksResult>;
}
