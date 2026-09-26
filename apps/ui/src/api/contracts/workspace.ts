import type { CoverageReason } from './coverage';

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

export interface WorkspaceApi {
  /** Reads a chapter's stored word alignment joined with its paragraphs and items' current played ranges. Never
   * runs anything. */
  workspaceAlignment(chapterId: string): Promise<WorkspaceAlignmentResult>;
}
