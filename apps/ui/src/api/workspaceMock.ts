// The browser mock's edit-and-proof workspace alignment (edit-and-proof-workspace.prd.md Phase 1). It shares the
// coverage mock's state, reasons and basis (an alignment is only ever as current as the coverage result it came
// from) and builds tokens straight from the mock manuscript's real paragraph text, one per whitespace word, read in
// order at a narration pace. It never runs anything (Q14). The played-range join (WorkspaceItem.live) stays false:
// the coverage mock's synthetic item GUIDs and the tracks mock's real ones are not the same fixture universe, and
// wiring them together is Phase 2's job once the workspace UI exists to use it.
import type { CoverageResult, ManuscriptChapter, ManuscriptParagraph, WorkspaceAlignmentResult, WorkspaceApi, WorkspaceItem, WorkspaceToken } from '../types';

type Deps = {
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
  coverageResult: (chapterId: string) => CoverageResult;
};

/** A narration pace, for the mock's token times only (matches coverageMock.ts's own). */
const WORDS_PER_MINUTE = 155;
const SECONDS_PER_WORD = 60 / WORDS_PER_MINUTE;

function mockTokens(paragraphs: ManuscriptParagraph[]): WorkspaceToken[] {
  const tokens: WorkspaceToken[] = [];
  let index = 0;
  let elapsed = 0;
  for (const paragraph of paragraphs) {
    paragraph.text
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word, ordinal) => {
        const start = elapsed;
        elapsed += SECONDS_PER_WORD;
        tokens.push({ i: index++, p: paragraph.id, w: ordinal, text: word, status: 'read', item: 0, start, end: elapsed });
      });
  }
  return tokens;
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
      const item: WorkspaceItem = { index: 0, itemGuid: `{${chapterId}-item-1}`, live: false };
      return { ...base, paragraphs: chapterParagraphs.map(({ id, text }) => ({ id, text })), tokens: mockTokens(chapterParagraphs), items: [item] };
    },
  };
}
