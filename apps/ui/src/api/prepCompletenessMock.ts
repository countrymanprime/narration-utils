import type { ManuscriptChapter } from './contracts/manuscript';
import type { PrepCompletenessSummary } from './contracts/prepCompleteness';
import type { PronunciationQuery } from './contracts/storyBible';

// Mirrors apps/desktop/internal/prepcompleteness.Build: a query's `chapter` field is the chapter's title, not its id
// (the same provisional, title-based match the real host uses - see bindings_prepcompleteness.go), and a chapter's
// stale-span count comes from the same prepMarkupList call the reader itself would make.

export function buildPrepCompletenessSummaryMock(
  chapters: ManuscriptChapter[],
  queries: PronunciationQuery[],
  staleSpansByChapterId: Map<string, number>,
): PrepCompletenessSummary {
  const openByTitle = new Map<string, number>();
  for (const query of queries) {
    if (query.chapter) openByTitle.set(query.chapter, (openByTitle.get(query.chapter) ?? 0) + 1);
  }
  const matchedTitles = new Set(chapters.map((chapter) => chapter.title));
  const rows = chapters.map((chapter) => {
    const openQueries = openByTitle.get(chapter.title) ?? 0;
    const staleMarkupSpans = staleSpansByChapterId.get(chapter.id) ?? 0;
    return { chapterId: chapter.id, title: chapter.title, openQueries, staleMarkupSpans, complete: openQueries === 0 && staleMarkupSpans === 0 };
  });
  let unattributedQueries = 0;
  for (const query of queries) {
    if (!query.chapter || !matchedTitles.has(query.chapter)) unattributedQueries++;
  }
  const totals = rows.reduce(
    (running, row) => ({
      chapters: running.chapters + 1,
      completeChapters: running.completeChapters + (row.complete ? 1 : 0),
      openQueries: running.openQueries + row.openQueries,
      staleMarkupSpans: running.staleMarkupSpans + row.staleMarkupSpans,
      unattributedQueries: running.unattributedQueries,
    }),
    { chapters: 0, completeChapters: 0, openQueries: unattributedQueries, staleMarkupSpans: 0, unattributedQueries },
  );
  return { chapters: rows, totals };
}
