// The browser mock's preview candidates (proofing-preview-suggestion.prd.md Phase 2), answering the shape
// apps/desktop/bindings_preview.go's PreviewCandidates does. It is a simplified, deterministic stand-in for Phase
// 1's real Go ranking engine (apps/desktop/internal/preview), not a port of it: good enough to drive every named
// state (`ok` with candidates, `no_manuscript`, `nothing_eligible`) for the Phase 3 panel and its tests, not to
// reproduce the engine's scoring byte for byte.
//
// Phase 8 adds the narrator's pin, kept in memory the same way createPrepMarkupMock (prepMarkupMock.ts) keeps its
// spans: resolved against the mock manuscript's current chapters and paragraphs on every read, so a seed that
// edits the manuscript after pinning (or simply asks for a stale one) is reported stale the same way the real host
// binding (bindings_preview_pin.go) would be.
import type {
  ManuscriptChapter,
  ManuscriptParagraph,
  PinnedPreview,
  PreviewApi,
  PreviewCandidate,
  PreviewOutcome,
  PreviewPinStaleReason,
  PreviewResult,
} from '../types';
import { wireClone } from './mockFixtures';

export type PreviewSeed = {
  /** Forces this outcome instead of computing one from the mock manuscript's own chapters and paragraphs. */
  outcome?: PreviewOutcome;
  /** Candidates to answer with instead of the default ones built from the mock manuscript's own chapters and
   * paragraphs (still requires `outcome` to be `'ok'`, or omitted with eligible chapters present). */
  candidates?: PreviewCandidate[];
  /** Never resolves, so the panel's "Computing suggestions…" state can be captured (Phase 3's visual suite). */
  hold?: boolean;
  /** Seeds a pinned window (Phase 8), present from the mock's very first read rather than requiring a
   * `previewPinSet` call first - the visual suite's own way of capturing the pinned states directly. */
  pin?: {
    chapterId: string;
    paragraphIds: string[];
    /** `'text_changed'` stores different anchor text than the paragraphs currently have; `'paragraph_missing'`
     * pins an id no paragraph has. Omitted seeds a fresh, non-stale pin. */
    stale?: PreviewPinStaleReason;
  };
};

type Deps = {
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
};

/** The app's own fixed pace estimate (apps/ui/src/state.ts's WORDS_PER_FINISHED_HOUR, matching the Go engine's own
 * preview.WordsPerFinishedHour), and the engine's own default target and tolerance (preview.DefaultSettings). */
const WORDS_PER_FINISHED_HOUR = 9300;
const WORDS_PER_SECOND = WORDS_PER_FINISHED_HOUR / 3600;
const TARGET_SECONDS = 300;
const TOLERANCE_FRACTION = 0.1;

function wordCountOf(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** One candidate per eligible (narration, or an unclassified import) chapter with at least one paragraph, in chapter
 * order, capped at three (Q12) - not ranked by the real features (dialogue, entities, hard words), since the mock
 * has no reason to reproduce that scoring to drive a state. */
function defaultCandidates(chapters: ManuscriptChapter[], paragraphs: ManuscriptParagraph[]): PreviewCandidate[] {
  const eligible = [...chapters].sort((a, b) => a.index - b.index).filter((chapter) => !chapter.contentKind || chapter.contentKind === 'narration');
  const candidates: PreviewCandidate[] = [];
  for (const chapter of eligible) {
    const chapterParagraphs = paragraphs.filter((paragraph) => paragraph.chapterId === chapter.id).sort((a, b) => a.index - b.index);
    if (chapterParagraphs.length === 0) continue;
    candidates.push(
      evaluateRange(
        chapter,
        chapterParagraphs.map((paragraph) => paragraph.id),
        chapterParagraphs,
      ),
    );
  }
  return candidates.slice(0, 3);
}

/** Scores one arbitrary contiguous paragraph range the same way defaultCandidates' own per-chapter windows are
 * built - shared by previewCandidates' default fixture and every pin read/adjust below, so a pinned, adjusted
 * window reads exactly like a suggested one (bindings_preview_pin.go's own EvaluateRange precedent). */
function evaluateRange(chapter: ManuscriptChapter, paragraphIds: string[], orderedParagraphs: ManuscriptParagraph[]): PreviewCandidate {
  const wordCount = orderedParagraphs.reduce((total, paragraph) => total + wordCountOf(paragraph.text), 0);
  const estimatedSeconds = wordCount / WORDS_PER_SECOND;
  const shorter = estimatedSeconds < TARGET_SECONDS * (1 - TOLERANCE_FRACTION);
  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    paragraphIds,
    wordCount,
    estimatedSeconds,
    shorter,
    reasons: ['Starts and ends on paragraph boundaries.'],
    warnings: shorter ? ['This chapter is shorter than the target length even in full.'] : [],
  };
}

/** One chapter's paragraphs, in reading order - the pin bindings' own "the caller trusts no order but its own"
 * rule (apps/desktop/internal/preview/engine.go's chapterParagraphs). */
function chapterParagraphsOrdered(paragraphs: ManuscriptParagraph[], chapterId: string): ManuscriptParagraph[] {
  return paragraphs.filter((paragraph) => paragraph.chapterId === chapterId).sort((a, b) => a.index - b.index);
}

/** Grows or shrinks currentIds by one paragraph at edge within chapterParagraphs, mirroring
 * apps/desktop/internal/preview/pin.go's AdjustRange: undefined when currentIds does not resolve to a contiguous
 * run of chapterParagraphs' own ids, unchanged (a no-op) once that edge already reaches its limit. */
function adjustRange(chapterParagraphs: ManuscriptParagraph[], currentIds: string[], edge: 'start' | 'end', grow: boolean): string[] | undefined {
  if (currentIds.length === 0 || chapterParagraphs.length === 0) return undefined;
  const indexOf = new Map(chapterParagraphs.map((paragraph, index) => [paragraph.id, index]));
  const startIdx = indexOf.get(currentIds[0]);
  const endIdx = indexOf.get(currentIds[currentIds.length - 1]);
  if (startIdx === undefined || endIdx === undefined || endIdx < startIdx || endIdx - startIdx + 1 !== currentIds.length) return undefined;
  for (let i = 0; i < currentIds.length; i++) {
    if (chapterParagraphs[startIdx + i]?.id !== currentIds[i]) return undefined;
  }
  let start = startIdx;
  let end = endIdx;
  if (edge === 'start' && grow && start > 0) start--;
  else if (edge === 'start' && !grow && end > start) start++;
  else if (edge === 'end' && grow && end < chapterParagraphs.length - 1) end++;
  else if (edge === 'end' && !grow && end > start) end--;
  return chapterParagraphs.slice(start, end + 1).map((paragraph) => paragraph.id);
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

type StoredPin = { chapterId: string; paragraphIds: string[]; anchorText: Record<string, string>; pinnedAt: string };

const noPin: PinnedPreview = { present: false, stale: false, canExtendStart: false, canShrinkStart: false, canExtendEnd: false, canShrinkEnd: false };

export function createPreviewMock(deps: Deps, seed?: PreviewSeed): PreviewApi {
  let pin: StoredPin | undefined;
  // The demo manuscript (aliceManuscript.ts) loads asynchronously, so deps.paragraphs() can still be empty at
  // createPreviewMock's own call time (mockApi.ts builds every feature mock up front, before that load settles) -
  // the same reason createPrepMarkupMock (prepMarkupMock.ts) defers its own seed until first use. Seeding here
  // eagerly would anchor `seed.pin` against no text at all, so every read (even the non-stale seed) would compare
  // against real text later and report stale unconditionally.
  let pinSeeded = false;
  const ensurePinSeeded = (): void => {
    if (pinSeeded) return;
    pinSeeded = true;
    if (seed?.pin) pin = seedPin(seed.pin, deps.paragraphs());
  };

  const anchorTextFor = (paragraphIds: string[]): Record<string, string> => {
    const byId = new Map(deps.paragraphs().map((paragraph) => [paragraph.id, paragraph.text]));
    const anchor: Record<string, string> = {};
    for (const id of paragraphIds) {
      const text = byId.get(id);
      if (text === undefined) throw new Error('one or more of those paragraphs are not in that chapter');
      anchor[id] = text;
    }
    return anchor;
  };

  const resolvePin = (): PinnedPreview => {
    ensurePinSeeded();
    if (!pin) return noPin;
    const chapter = deps.chapters().find((candidate) => candidate.id === pin!.chapterId);
    const currentById = new Map(deps.paragraphs().map((paragraph) => [paragraph.id, paragraph.text]));
    let staleReason: PreviewPinStaleReason | undefined;
    if (!chapter) {
      staleReason = 'paragraph_missing';
    } else {
      for (const id of pin.paragraphIds) {
        const text = currentById.get(id);
        if (text === undefined) {
          staleReason = 'paragraph_missing';
          break;
        }
        if (text !== pin.anchorText[id]) staleReason = 'text_changed';
      }
    }
    const chapterParagraphs = chapter ? chapterParagraphsOrdered(deps.paragraphs(), pin.chapterId) : [];
    const candidate =
      chapter && staleReason !== 'paragraph_missing'
        ? evaluateRange(
            chapter,
            pin.paragraphIds,
            pin.paragraphIds.map((id) => chapterParagraphs.find((paragraph) => paragraph.id === id)!),
          )
        : undefined;
    const canAdjust = (edge: 'start' | 'end', grow: boolean): boolean => {
      if (staleReason === 'paragraph_missing') return false;
      const ids = adjustRange(chapterParagraphs, pin!.paragraphIds, edge, grow);
      return ids !== undefined && !sameIds(ids, pin!.paragraphIds);
    };
    return {
      present: true,
      candidate,
      stale: staleReason !== undefined,
      staleReason,
      pinnedAt: pin.pinnedAt,
      canExtendStart: canAdjust('start', true),
      canShrinkStart: canAdjust('start', false),
      canExtendEnd: canAdjust('end', true),
      canShrinkEnd: canAdjust('end', false),
    };
  };

  return {
    previewCandidates: (): Promise<PreviewResult> => {
      // Never resolves: the panel's "Computing suggestions…" state has nothing else to hold on (no job to poll).
      if (seed?.hold) return new Promise<PreviewResult>(() => {});
      if (seed?.outcome === 'no_manuscript') return Promise.resolve(wireClone<PreviewResult>({ outcome: 'no_manuscript', candidates: [] }));
      if (seed?.outcome === 'nothing_eligible') return Promise.resolve(wireClone<PreviewResult>({ outcome: 'nothing_eligible', candidates: [] }));
      const chapters = deps.chapters();
      if (chapters.length === 0) return Promise.resolve(wireClone<PreviewResult>({ outcome: 'no_manuscript', candidates: [] }));
      const candidates = seed?.candidates ?? defaultCandidates(chapters, deps.paragraphs());
      if (candidates.length === 0) return Promise.resolve(wireClone<PreviewResult>({ outcome: 'nothing_eligible', candidates: [] }));
      return Promise.resolve(wireClone<PreviewResult>({ outcome: 'ok', candidates }));
    },
    previewPin: (): Promise<PinnedPreview> => Promise.resolve(wireClone(resolvePin())),
    previewPinSet: (chapterId, paragraphIds): Promise<PinnedPreview> => {
      pinSeeded = true;
      pin = { chapterId, paragraphIds, anchorText: anchorTextFor(paragraphIds), pinnedAt: new Date().toISOString() };
      return Promise.resolve(wireClone(resolvePin()));
    },
    previewPinAdjust: (edge, grow): Promise<PinnedPreview> => {
      ensurePinSeeded();
      if (!pin) throw new Error('no preview is pinned');
      const chapterParagraphs = chapterParagraphsOrdered(deps.paragraphs(), pin.chapterId);
      const ids = adjustRange(chapterParagraphs, pin.paragraphIds, edge, grow);
      if (!ids) throw new Error('this pin can no longer be adjusted; clear it and pin a new one');
      pin = { ...pin, paragraphIds: ids, anchorText: anchorTextFor(ids), pinnedAt: new Date().toISOString() };
      return Promise.resolve(wireClone(resolvePin()));
    },
    previewPinClear: (): Promise<PinnedPreview> => {
      pinSeeded = true;
      pin = undefined;
      return Promise.resolve(wireClone(resolvePin()));
    },
  };
}

/** Builds a StoredPin from a PreviewSeed's `pin` option: `stale: 'text_changed'` stores anchor text that no longer
 * matches (a placeholder, distinct from whatever the real text is); `'paragraph_missing'` pins an id alongside the
 * requested ones that no paragraph has. */
function seedPin(seed: NonNullable<PreviewSeed['pin']>, paragraphs: ManuscriptParagraph[]): StoredPin {
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph.text]));
  const paragraphIds = seed.stale === 'paragraph_missing' ? [...seed.paragraphIds, `${seed.paragraphIds[0] ?? 'p'}-removed`] : seed.paragraphIds;
  const anchorText: Record<string, string> = {};
  for (const id of paragraphIds) {
    const current = byId.get(id);
    anchorText[id] = seed.stale === 'text_changed' ? `${current ?? ''} (seed: earlier wording)` : (current ?? '');
  }
  return { chapterId: seed.chapterId, paragraphIds, anchorText, pinnedAt: '2026-09-27T12:00:00.000Z' };
}
