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
  ManuscriptChapter,
  ManuscriptParagraph,
  TrackMapping,
  TracksProject,
  WorkspaceAlignmentResult,
  WorkspaceApi,
  WorkspaceExtra,
  WorkspaceItem,
  WorkspaceToken,
} from '../types';

type Deps = {
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
  coverageResult: (chapterId: string) => CoverageResult;
  project: TracksProject;
  mappings: () => TrackMapping[];
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

export function createWorkspaceMock(deps: Deps): WorkspaceApi {
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
  };
}
