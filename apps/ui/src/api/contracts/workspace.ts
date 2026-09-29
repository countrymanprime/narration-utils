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

/** The narrator's FX chains, from REAPER's FXChains folder (edit-and-proof-workspace.prd.md Phase 8, ADR 0234): by
 * relative name, sorted; truncated is true when the bridge's depth or count limit left some out. Read-only. The
 * narrator's favourites are a Settings field (DAW.fx_favourites), not part of this read. */
export type WorkspaceFXChainsResult = { names: string[]; truncated: boolean };

/** REAPER's installed plug-ins by name (list_fx, edit-and-proof-workspace.prd.md Phase 9, ADR 0234), sorted, without the
 * FX container or the video processor; truncated is true when the bridge's limit left some out. Read-only. */
export type WorkspaceFXPluginsResult = { names: string[]; truncated: boolean };

/** Why adding an effect was refused before or by REAPER (apps/desktop/bindings_workspace_fx_apply.go); nothing in REAPER
 * changed. The first eight are the navigation refusals every workspace REAPER action shares; crosses_items (a passage
 * on two items), bad_range (a selection outside the alignment), bad_name (a plug-in or chain name REAPER would not
 * take) and no_track (the chapter has no checked track for a chain) are this action's own. */
export type WorkspaceFXRefusalReason =
  | 'standalone'
  | 'not_running'
  | 'no_item'
  | 'no_source_time'
  | 'stale'
  | 'recording'
  | 'script_outdated'
  | 'failed'
  | 'crosses_items'
  | 'bad_range'
  | 'bad_name'
  | 'no_track';

/** What adding a plug-in to a passage, or a chain to the chapter's track, did. `added`: the plug-in went on the middle
 * piece of the split item (itemGuid and takeGuid name that piece; splits is 0 to 2 cuts). `applied`: the chain went on
 * the track, `added` FX in all. Either is one Undo in REAPER. */
export type WorkspaceFXResult =
  | { outcome: 'added'; plugin: string; itemGuid: string; takeGuid: string; splits: number }
  | { outcome: 'applied'; chain: string; track: string; added: number }
  | { outcome: 'refused'; reason: WorkspaceFXRefusalReason; message: string };

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
  /** Lists the narrator's FX chains (list_fx_chains, Phase 8). Refused offline or before the DAW port's FX chains
   * capability is on (the same experimental gate as Phase 9's apply). */
  workspaceListFXChains(): Promise<WorkspaceFXChainsResult>;
  /** Lists REAPER's installed plug-ins (list_fx, Phase 9), for the passage menu. Refused offline like the chains list. */
  workspaceListFX(): Promise<WorkspaceFXPluginsResult>;
  /** Puts one plug-in on the passage firstToken..lastToken of a chapter (add_take_fx, Phase 9, ADR 0234): the host
   * resolves the tokens to one item's source range, REAPER splits the passage out and adds the plug-in to it, in one
   * undo step. The page sends no GUID or time. Send it only after the narrator confirms. */
  workspaceAddTakeFX(chapterId: string, firstToken: number, lastToken: number, plugin: string): Promise<WorkspaceFXResult>;
  /** Puts one of the narrator's FX chains (a name workspaceListFXChains listed) on the chapter's own track
   * (apply_fx_chain, Phase 9): the host names the track, the page cannot. One undo step. Send it only after the
   * narrator confirms. */
  workspaceApplyFXChain(chapterId: string, chain: string): Promise<WorkspaceFXResult>;
  /** Reads the waveform strip's peaks for every analyzed item of a chapter's stored alignment (edit-and-proof-
   * workspace PRD Phase 5): host-computed from each item's active take's source file, cached by source identity. */
  workspacePeaks(chapterId: string): Promise<WorkspacePeaksResult>;
}
