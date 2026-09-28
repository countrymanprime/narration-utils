/**
 * Prep completeness summary (docs/prds/prep-depth.prd.md Phase 7, Could): a per-chapter rollup of open pronunciation
 * queries (Phase 3) and unresolved markup staleness (Phase 5), read by the Production home's Prep column
 * (stage-navigation-and-page-replacement.prd.md D79). It reads Phases 3 and 5's own data and adds no store of its
 * own. The host shape is apps/desktop/internal/prepcompleteness and apps/desktop/bindings_prepcompleteness.go.
 */

/** One manuscript chapter's rollup. `complete` is true only with no open query and no stale markup span. */
export type PrepCompletenessChapter = {
  chapterId: string;
  title: string;
  openQueries: number;
  staleMarkupSpans: number;
  complete: boolean;
};

/** Book-wide figures. `unattributedQueries` is folded into `openQueries`, but names no chapter: a query whose name
 * never occurs in the text, or whose recorded chapter title no longer matches a current chapter. */
export type PrepCompletenessTotals = {
  chapters: number;
  completeChapters: number;
  openQueries: number;
  staleMarkupSpans: number;
  unattributedQueries: number;
};

export type PrepCompletenessSummary = {
  chapters: PrepCompletenessChapter[];
  totals: PrepCompletenessTotals;
};

export interface PrepCompletenessApi {
  /** One row per manuscript chapter, in book order, plus the book-wide totals. */
  prepCompletenessSummary(): Promise<PrepCompletenessSummary>;
}
