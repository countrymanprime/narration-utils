// The browser mock's edit-and-proof workspace alignment (edit-and-proof-workspace.prd.md Phases 1 and 2). It shares the
// coverage mock's state, reasons and basis (an alignment is only ever as current as the coverage result it came
// from) and builds tokens from the mock manuscript's real paragraph text, one per whitespace word, read in order at
// a narration pace. It never runs anything (Q14). The played-range join (WorkspaceItem.live) is real when the
// chapter has a confirmed, still-live track link (mockChapterLink=confirmed, or chapterTrackMappings seeded some
// other way): the workspace's own player needs a real item GUID and source file to seek the mock's fake WAV
// (mockAudioSource, apps/ui/src/api/mockApi.ts) against, same as Tracks' player does.
import type {
  CoverageReport,
  CoverageResult,
  FindingNavigation,
  FindingNavigationRefusal,
  ManuscriptChapter,
  ManuscriptParagraph,
  TrackMapping,
  TracksProject,
  WorkspaceAlignmentResult,
  WorkspaceApi,
  WorkspaceExtra,
  WorkspaceFXChainsResult,
  WorkspaceFXPluginsResult,
  WorkspaceFXRefusalReason,
  WorkspaceFXResult,
  WorkspaceItem,
  WorkspacePeaks,
  WorkspacePeaksEntry,
  WorkspaceToken,
} from '../types';
import { LOOP_PADDING_SECONDS, REAPER_MESSAGES, type MockReaper } from './findingsMock';

type Deps = {
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
  coverageResult: (chapterId: string) => CoverageResult;
  project: TracksProject;
  mappings: () => TrackMapping[];
  /** What the mock's REAPER does for Go to and Loop (edit-and-proof-workspace PRD Phase 3), shared with the Review
   * page's own mock REAPER (`initial.reaper`, mockApi.ts); `connected` when not given. */
  reaper?: MockReaper;
  /** Mirrors `findingNavigation.loopingID` (bindings_navigation.go): mockApi.ts reads this after a successful
   * workspaceLoop to answer `findingsReaperStatus`'s `loopingFindingId` and to let `findingsStopLoop` clear it, so
   * the workspace's own loop is remembered the same way a finding's is (across a poll, a leave and a return). */
  looping?: { current: string | undefined };
  /** The narrator's FX chains for workspaceListFXChains (Phase 8): a small realistic sample when not given. */
  fxChains?: string[];
  /** REAPER's installed plug-ins for workspaceListFX (Phase 9): a small realistic sample when not given. */
  fxPlugins?: string[];
};

const DEFAULT_MOCK_FX_CHAINS = ['Podcast Voice.RfxChain', 'Vocal Warmth.RfxChain'];
const DEFAULT_MOCK_PLUGINS = ['JS: De-esser', 'ReaComp (Cockos)', 'ReaEQ (Cockos)', 'ReaXcomp (Cockos)'];
const MOCK_TRACK_GUID = '{MOCK-TRACK-0000-0000-000000000001}';

const fxRefused = (reason: WorkspaceFXRefusalReason, message: string): WorkspaceFXResult => ({ outcome: 'refused', reason, message });

const refused = (reason: FindingNavigationRefusal, message: string): FindingNavigation => ({ outcome: 'refused', reason, message });

// The workspace's own words for a token that cannot be placed (apps/desktop/bindings_workspace.go): a word, never
// "this finding" - REAPER_MESSAGES.standalone/notRunning/stale/recording/outdated are connection- and REAPER-level,
// so they read the same for any caller and are reused as-is.
const WORKSPACE_MESSAGES = {
  noItem: "This word wasn't heard in the recording, so there's nothing to go to. Run the check again if the chapter has changed.",
  noSourceTime: 'This word has no time in its audio to loop. Go to it instead.',
};

// The passage-effect refusals in the host's words (apps/desktop/bindings_workspace_fx_apply.go).
const FX_MESSAGES = {
  badRange: "That selection is not in this chapter's alignment. Reload the chapter and select the words again.",
  noItem: "These words weren't heard in the recording, so there's no audio to put an effect on. Run the check again if the chapter has changed.",
  crossesItems: 'This passage crosses two REAPER items. Select words from one item at a time.',
  noTrack: 'This chapter has no checked track in REAPER to put a chain on. Run the check first.',
};

/** A narration pace, for the mock's token times only (matches coverageMock.ts's own). */
const WORDS_PER_MINUTE = 155;
const SECONDS_PER_WORD = 60 / WORDS_PER_MINUTE;

/** A cheap, deterministic stand-in for "what Whisper heard" on one demonstration word - not a real ASR confusion,
 * just something a screenshot can show next to the correct word (mockups/edit-and-proof-workspace/02-flag-detail-open.webp). */
function mockMisheard(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return `${text}h`;
  return text.replace(letters, letters.slice(1) + letters[0]);
}

function regionParagraphIds(report: CoverageReport, kind: CoverageReport['regions'][number]['kind']): Set<string> {
  const ids = new Set<string>();
  report.regions.filter((region) => region.kind === kind).forEach((region) => region.paragraphIds.forEach((id) => ids.add(id)));
  return ids;
}

/** The chapter's linked track's first playable item, real and live - the same fixture Tracks reads (WIRE_TRACKS_PROJECT) -
 * so the workspace's own player has a real itemGuid/sourceFile to seek the mock audio source against. Empty when the
 * chapter has no confirmed link, or its link points at a track no longer in the project (as ChapterTrackButton shows it). */
function mockLiveItem(deps: Deps, chapterId: string): WorkspaceItem | undefined {
  const mapping = deps.mappings().find((entry) => entry.chapterId === chapterId);
  const track = mapping ? deps.project.tracks.find((candidate) => candidate.guid === mapping.trackGuid) : undefined;
  const item = track?.items.find((candidate) => candidate.supported && candidate.sourceAvailable);
  if (!item) return undefined;
  return {
    index: 0,
    itemGuid: item.guid,
    live: true,
    takeGuid: item.takeGuid,
    sourceStart: item.sourceStart,
    playRate: item.playRate,
    position: item.position,
    length: item.length,
  };
}

function mockTokens(
  paragraphs: ManuscriptParagraph[],
  report: CoverageReport | undefined,
  itemIndex: number | undefined,
): { tokens: WorkspaceToken[]; extras: WorkspaceExtra[] } {
  const skipIds = report ? regionParagraphIds(report, 'skip') : new Set<string>();
  const tailIds = report ? regionParagraphIds(report, 'tail') : new Set<string>();
  const shortIds = report ? regionParagraphIds(report, 'short_read') : new Set<string>();

  const tokens: WorkspaceToken[] = [];
  const extras: WorkspaceExtra[] = [];
  let index = 0;
  let elapsed = 0;
  let misheardPlaced = false;
  for (const paragraph of paragraphs) {
    const words = paragraph.text.split(/\s+/).filter(Boolean);
    const wholeParagraphSkipped = skipIds.has(paragraph.id);
    const wholeParagraphTail = tailIds.has(paragraph.id);
    const halfReadShort = shortIds.has(paragraph.id);
    words.forEach((word, ordinal) => {
      const start = elapsed;
      const end = start + SECONDS_PER_WORD;
      elapsed = end;
      const missing = wholeParagraphSkipped || wholeParagraphTail || (halfReadShort && ordinal >= Math.ceil(words.length / 2));
      if (missing) {
        tokens.push({ i: index, p: paragraph.id, w: ordinal, text: word, status: wholeParagraphTail ? 'tail' : wholeParagraphSkipped ? 'skip' : 'short_read' });
      } else if (!misheardPlaced && word.length >= 3 && itemIndex !== undefined) {
        // One deterministic misread, for the flag legend and detail panel to have something real to show.
        tokens.push({ i: index, p: paragraph.id, w: ordinal, text: word, status: 'misread', heard: mockMisheard(word), item: itemIndex, start, end });
        misheardPlaced = true;
        // A short repeat right after it (edit-and-proof-workspace.prd.md flags table, "extra words, repeats"): the
        // narrator said the previous word again before moving on.
        extras.push({
          text: word,
          tokens: 1,
          start: { itemIndex, itemGuid: '', sourceTime: end },
          end: { itemIndex, itemGuid: '', sourceTime: end + SECONDS_PER_WORD },
          afterToken: index,
        });
      } else if (itemIndex !== undefined) {
        tokens.push({ i: index, p: paragraph.id, w: ordinal, text: word, status: 'read', item: itemIndex, start, end });
      } else {
        // No live item to attach a time to (no confirmed track link): the text still shows, with no playable position.
        tokens.push({ i: index, p: paragraph.id, w: ordinal, text: word, status: 'read' });
      }
      index += 1;
    });
  }
  return { tokens, extras };
}

// tokensFor is workspaceAlignment's own tokens and live item for a chapter, reused by workspaceGoTo/workspaceLoop so
// a token index they are sent resolves to the same item and source time workspaceAlignment showed for it.
function tokensFor(deps: Deps, chapterId: string): { tokens: WorkspaceToken[]; liveItem: WorkspaceItem | undefined } {
  const result = deps.coverageResult(chapterId);
  const chapter = deps.chapters().find((candidate) => candidate.id === chapterId);
  if (!chapter || result.state === 'never') return { tokens: [], liveItem: undefined };
  const chapterParagraphs = deps.paragraphs().filter((paragraph) => paragraph.chapterId === chapterId);
  const liveItem = mockLiveItem(deps, chapterId);
  return { tokens: mockTokens(chapterParagraphs, result.result, liveItem?.index).tokens, liveItem };
}

/** The one deterministic misread token's real position for chapterId (mockTokens's single seeded misread, above): the
 * live item's real GUID and the misread word's source time range, for a Phase 4 `transcript_discrepancy` mock finding
 * to carry - so the mock Review-page finding and the mock workspace's own check-derived misread flag are the same
 * event, merged by `overlayFindings` in the workspace exactly as mockups/edit-and-proof-workspace/02-flag-detail-open.webp
 * shows, rather than two mock fixtures whose numbers happen to agree. Undefined when the chapter has no confirmed
 * live item or its check placed no misread (mockTokens never times a token without one). */
export function mockMisreadFindingSource(deps: Deps, chapterId: string): { itemGuid: string; start: number; end: number; heard: string } | undefined {
  const { tokens, liveItem } = tokensFor(deps, chapterId);
  const misread = tokens.find(
    (token): token is WorkspaceToken & { start: number; end: number; heard: string } =>
      token.status === 'misread' && token.start !== undefined && token.end !== undefined && token.heard !== undefined,
  );
  if (!liveItem || !misread) return undefined;
  return { itemGuid: liveItem.itemGuid, start: misread.start, end: misread.end, heard: misread.heard };
}

// reaperRefusal is the connection- and REAPER-level part of workspaceRefusal (bindings_workspace.go): standalone, not
// running, stale, recording, an old script. It never sees the token itself - workspaceGoTo/workspaceLoop check that first.
function reaperRefusal(mode: MockReaper): FindingNavigation | undefined {
  if (mode === 'standalone') return refused('standalone', REAPER_MESSAGES.standalone);
  if (mode === 'not-running') return refused('not_running', REAPER_MESSAGES.notRunning);
  if (mode === 'stale') return refused('stale', REAPER_MESSAGES.stale);
  if (mode === 'recording') return refused('recording', REAPER_MESSAGES.recording);
  if (mode === 'outdated') return refused('script_outdated', REAPER_MESSAGES.outdated);
  return undefined;
}

/** A deterministic stand-in for measure.ComputePeaks (edit-and-proof-workspace.prd.md Phase 5, ADR 0520): a smooth
 * envelope rather than real sample data, but the same bucket rate and byte layout the host sends, and identical
 * from one call to the next - the visual suite masks a waveform state only when its content is non-deterministic
 * (state-catalog.ts), and this mock's is not. */
const MOCK_BUCKETS_PER_SECOND = 50;

function mockPeaksFor(item: WorkspaceItem): WorkspacePeaks {
  const playedSeconds = Math.max(0, (item.length ?? 0) * (item.playRate ?? 1));
  const buckets = Math.round(playedSeconds * MOCK_BUCKETS_PER_SECOND);
  const bytes = new Int8Array(buckets * 2);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    // A slow envelope (a "paragraph" of louder and quieter passages) plus a fast, cheap ripple - never random, so
    // the same chapter always draws the same strip.
    const envelope = 40 + 35 * Math.sin(bucket / 60) ** 2;
    const ripple = 20 * Math.sin(bucket * 1.3) * Math.sin(bucket / 7);
    const amplitude = Math.max(0, Math.min(126, Math.round(envelope + ripple)));
    bytes[2 * bucket] = -amplitude;
    bytes[2 * bucket + 1] = amplitude;
  }
  const minMax = btoa(String.fromCharCode(...new Uint8Array(bytes.buffer)));
  return { startSeconds: 0, bucketsPerSecond: MOCK_BUCKETS_PER_SECOND, buckets, minMax, sampleRate: 48000, channels: 1 };
}

export function createWorkspaceMock(deps: Deps): WorkspaceApi {
  const mode = deps.reaper ?? 'connected';
  const target = (chapterId: string, tokenIndex: number): WorkspaceToken | undefined => tokensFor(deps, chapterId).tokens[tokenIndex];

  return {
    workspaceAlignment: async (chapterId) => {
      const result = deps.coverageResult(chapterId);
      const base: WorkspaceAlignmentResult = {
        chapterId,
        state: result.state,
        reasons: result.reasons,
        ...(result.basis ? { basis: result.basis } : {}),
        needsAlignAgain: false,
        paragraphs: [],
        tokens: [],
        extras: [],
        items: [],
      };
      const chapter = deps.chapters().find((candidate) => candidate.id === chapterId);
      if (!chapter || result.state === 'never') return base;
      const chapterParagraphs = deps.paragraphs().filter((paragraph) => paragraph.chapterId === chapterId);
      const liveItem = mockLiveItem(deps, chapterId);
      const { tokens, extras } = mockTokens(chapterParagraphs, result.result, liveItem?.index);
      const resolvedExtras = extras.map((extra) => ({
        ...extra,
        start: { ...extra.start, itemGuid: liveItem?.itemGuid ?? '' },
        end: { ...extra.end, itemGuid: liveItem?.itemGuid ?? '' },
      }));
      return {
        ...base,
        paragraphs: chapterParagraphs.map(({ id, text }) => ({ id, text })),
        tokens,
        extras: resolvedExtras,
        items: liveItem ? [liveItem] : [],
      };
    },
    workspaceGoTo: async (chapterId, tokenIndex) => {
      const token = target(chapterId, tokenIndex);
      if (token?.item === undefined) return refused('no_item', WORKSPACE_MESSAGES.noItem);
      return reaperRefusal(mode) ?? { outcome: 'navigated', projectTime: token.start ?? 0 };
    },
    workspaceLoop: async (chapterId, firstToken, lastToken) => {
      const first = target(chapterId, firstToken);
      const last = target(chapterId, lastToken);
      if (first?.item === undefined || last?.item === undefined) return refused('no_item', WORKSPACE_MESSAGES.noItem);
      if (last.end === undefined) return refused('no_source_time', WORKSPACE_MESSAGES.noSourceTime);
      const refusal = reaperRefusal(mode);
      if (refusal) return refusal;
      if (deps.looping) deps.looping.current = `workspace:${chapterId}:${firstToken}-${lastToken}`;
      const start = first.start ?? 0;
      return { outcome: 'looping', loopStart: Math.max(start - LOOP_PADDING_SECONDS, 0), loopEnd: last.end + LOOP_PADDING_SECONDS };
    },
    workspaceListFXChains: async (): Promise<WorkspaceFXChainsResult> => {
      if (mode !== 'connected') throw new Error('REAPER is not connected to this app: open the app from the Narration Utils action in REAPER');
      return { names: deps.fxChains ?? DEFAULT_MOCK_FX_CHAINS, truncated: false };
    },
    workspaceListFX: async (): Promise<WorkspaceFXPluginsResult> => {
      if (mode !== 'connected') throw new Error('REAPER is not connected to this app: open the app from the Narration Utils action in REAPER');
      return { names: deps.fxPlugins ?? DEFAULT_MOCK_PLUGINS, truncated: false };
    },
    workspaceAddTakeFX: async (chapterId, firstToken, lastToken, plugin) => {
      const { tokens } = tokensFor(deps, chapterId);
      if (firstToken < 0 || lastToken < firstToken || lastToken >= tokens.length) return fxRefused('bad_range', FX_MESSAGES.badRange);
      const first = tokens[firstToken];
      const last = tokens[lastToken];
      if (first?.item === undefined || last?.item === undefined) return fxRefused('no_item', FX_MESSAGES.noItem);
      if (first.item !== last.item) return fxRefused('crosses_items', FX_MESSAGES.crossesItems);
      const refusal = reaperRefusal(mode);
      if (refusal?.outcome === 'refused') return fxRefused(refusal.reason, refusal.message);
      return {
        outcome: 'added',
        plugin,
        itemGuid: `{MOCK-PIECE-${firstToken}-${lastToken}}`,
        takeGuid: `{MOCK-PIECE-TAKE-${firstToken}-${lastToken}}`,
        splits: 2,
      };
    },
    workspaceApplyFXChain: async (chapterId, chain) => {
      if (!mockLiveItem(deps, chapterId)) return fxRefused('no_track', FX_MESSAGES.noTrack);
      const refusal = reaperRefusal(mode);
      if (refusal?.outcome === 'refused') return fxRefused(refusal.reason, refusal.message);
      return { outcome: 'applied', chain, track: MOCK_TRACK_GUID, added: 2 };
    },
    workspacePeaks: async (chapterId) => {
      const liveItem = mockLiveItem(deps, chapterId);
      const items: WorkspacePeaksEntry[] = liveItem ? [{ index: liveItem.index, peaks: mockPeaksFor(liveItem) }] : [];
      return { chapterId, items };
    },
  };
}
