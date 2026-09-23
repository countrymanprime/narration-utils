// The Review page's filter state and how it becomes the host's query. Filtering, sorting and paging run in the host (Q9 of
// review-dashboard-and-findings-adoption.prd.md); this only leaves an empty control out, so it matches everything.
import type { FindingReviewStatus, FindingSortKey, FindingsQuery } from '../../types';

export type ReviewFilterValues = {
  /** '' is every status; the other choice filters are '' for "all" too. */
  status: '' | FindingReviewStatus;
  category: string;
  analyzer: string;
  chapterId: string;
  sort: FindingSortKey;
  confidentOnly: boolean;
  includeNotInLatestRun: boolean;
};

export const EMPTY_FILTERS: ReviewFilterValues = {
  status: '',
  category: '',
  analyzer: '',
  chapterId: '',
  sort: 'chapter',
  confidentOnly: false,
  includeNotInLatestRun: false,
};

/** How many findings one page of the list asks for; "Show more" asks for as many again. */
export const REVIEW_PAGE_SIZE = 100;

/** The "only confident findings" switch asks the host for this minimum. The host leaves out a finding with no score too. */
export const CONFIDENT_MINIMUM = 0.5;

/** Whether any filter (not the sort) differs from showing everything. */
export const isFiltered = (values: ReviewFilterValues): boolean =>
  (Object.keys(EMPTY_FILTERS) as Array<keyof ReviewFilterValues>).some((key) => key !== 'sort' && values[key] !== EMPTY_FILTERS[key]);

export function queryFor(filters: ReviewFilterValues, limit: number): FindingsQuery {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.analyzer ? { analyzer: filters.analyzer } : {}),
    ...(filters.chapterId ? { chapterId: filters.chapterId } : {}),
    ...(filters.confidentOnly ? { minConfidence: CONFIDENT_MINIMUM } : {}),
    ...(filters.includeNotInLatestRun ? { includeNotInLatestRun: true } : {}),
    sort: filters.sort,
    limit,
  };
}
