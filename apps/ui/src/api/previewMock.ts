// The browser mock's preview candidates (proofing-preview-suggestion.prd.md Phase 2), answering the shape
// apps/desktop/bindings_preview.go's PreviewCandidates does. It is a simplified, deterministic stand-in for Phase
// 1's real Go ranking engine (apps/desktop/internal/preview), not a port of it: good enough to drive every named
// state (`ok` with candidates, `no_manuscript`, `nothing_eligible`) for the Phase 3 panel and its tests, not to
// reproduce the engine's scoring byte for byte.
import type { ManuscriptChapter, ManuscriptParagraph, PreviewApi, PreviewCandidate, PreviewOutcome, PreviewResult } from '../types';
import { wireClone } from './mockFixtures';

export type PreviewSeed = {
  /** Forces this outcome instead of computing one from the mock manuscript's own chapters and paragraphs. */
  outcome?: PreviewOutcome;
  /** Candidates to answer with instead of the default ones built from the mock manuscript's own chapters and
   * paragraphs (still requires `outcome` to be `'ok'`, or omitted with eligible chapters present). */
  candidates?: PreviewCandidate[];
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
    const wordCount = chapterParagraphs.reduce((total, paragraph) => total + wordCountOf(paragraph.text), 0);
    const estimatedSeconds = wordCount / WORDS_PER_SECOND;
    const shorter = estimatedSeconds < TARGET_SECONDS * (1 - TOLERANCE_FRACTION);
    candidates.push({
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      paragraphIds: chapterParagraphs.map((paragraph) => paragraph.id),
      wordCount,
      estimatedSeconds,
      shorter,
      reasons: ['Starts and ends on paragraph boundaries.'],
      warnings: shorter ? ['This chapter is shorter than the target length even in full.'] : [],
    });
  }
  return candidates.slice(0, 3);
}

export function createPreviewMock(deps: Deps, seed?: PreviewSeed): PreviewApi {
  return {
    previewCandidates: async () => {
      if (seed?.outcome === 'no_manuscript') return wireClone<PreviewResult>({ outcome: 'no_manuscript', candidates: [] });
      if (seed?.outcome === 'nothing_eligible') return wireClone<PreviewResult>({ outcome: 'nothing_eligible', candidates: [] });
      const chapters = deps.chapters();
      if (chapters.length === 0) return wireClone<PreviewResult>({ outcome: 'no_manuscript', candidates: [] });
      const candidates = seed?.candidates ?? defaultCandidates(chapters, deps.paragraphs());
      if (candidates.length === 0) return wireClone<PreviewResult>({ outcome: 'nothing_eligible', candidates: [] });
      return wireClone<PreviewResult>({ outcome: 'ok', candidates });
    },
  };
}
