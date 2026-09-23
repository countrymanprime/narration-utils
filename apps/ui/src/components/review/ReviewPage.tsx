import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import type { Finding, FindingsPage, FindingsSummary } from '../../types';
import { LoadError } from '../layout/LoadError';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import type { Notify } from '../primitives/Toast';
import { FindingDetail } from './FindingDetail';
import { FindingsList } from './FindingsList';
import { ReviewFilters } from './ReviewFilters';
import { EMPTY_FILTERS, isFiltered, queryFor, REVIEW_PAGE_SIZE, type ReviewFilterValues } from './reviewQuery';
import { STATUS_LABELS } from './findingFormat';

const countsLine = (summary: FindingsSummary): string =>
  (['unreviewed', 'accepted', 'dismissed', 'deferred'] as const).map((status) => `${summary[status]} ${STATUS_LABELS[status].toLowerCase()}`).join(' · ');

/**
 * The Review page (review-dashboard-and-findings-adoption.prd.md Phase 5, Q1: a page in the app, not a REAPER panel): every
 * analyzer's findings in one queue, filtered and sorted by the host, with a finding's evidence and the narrator's decision beside
 * the list.
 */
export function ReviewPage({
  notify,
  hasManuscript,
  goToManuscript,
  goToStoryBible,
}: {
  notify: Notify;
  hasManuscript: boolean;
  goToManuscript: (chapter: string, paragraph?: number) => void;
  goToStoryBible: (entityId: string) => void;
}) {
  const api = useApi();
  const [summary, setSummary] = useState<FindingsSummary>();
  const [page, setPage] = useState<FindingsPage>();
  const [loadError, setLoadError] = useState<string>();
  const [filters, setFilters] = useState<ReviewFilterValues>(EMPTY_FILTERS);
  const [limit, setLimit] = useState(REVIEW_PAGE_SIZE);
  const [selected, setSelected] = useState<Finding>();
  const [reloadKey, setReloadKey] = useState(0);
  const loadedOnce = useRef(false);

  // A failure before anything is on screen is the page's load error with Retry; a later one keeps what is shown and is a toast.
  const failed = useCallback(
    (error: unknown) => {
      if (loadedOnce.current) notify(describeApiError(error), 'error');
      else setLoadError(describeApiError(error));
    },
    [notify],
  );

  // The counts and the list are read together, so the page is either loaded or not; an answer that arrives after a newer request
  // was sent (the filters changed again) is dropped.
  useEffect(() => {
    let active = true;
    Promise.all([api.findingsSummary(), api.findingsList(queryFor(filters, limit))])
      .then(([nextSummary, nextPage]) => {
        if (!active) return;
        loadedOnce.current = true;
        setSummary(nextSummary);
        setPage(nextPage);
      })
      .catch((error) => active && failed(error));
    return () => {
      active = false;
    };
  }, [api, failed, filters, limit, reloadKey]);

  const changeFilters = (next: ReviewFilterValues) => {
    setLimit(REVIEW_PAGE_SIZE);
    setFilters(next);
  };

  // The detail's copy of a finding is the one the host answered last: a saved decision or the latest evidence after a refusal.
  const changed = (finding: Finding, decided: boolean) => {
    setSelected(finding);
    setPage((current) => current && { ...current, findings: current.findings.map((row) => (row.id === finding.id ? finding : row)) });
    if (decided) setReloadKey((key) => key + 1);
  };

  const retry = () => {
    setLoadError(undefined);
    setReloadKey((key) => key + 1);
  };

  if (loadError) return <LoadError title="Review" message={loadError} retry={retry} />;

  const nothingYet = summary !== undefined && summary.total === 0 && summary.notInLatestRun === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <Heading title="Review">{summary && !nothingYet ? countsLine(summary) : undefined}</Heading>
      </div>
      {nothingYet ? (
        <Panel title="Nothing to review yet">
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Findings appear here when a check has something for you to look at: run a comparison on the Proofing page, or build the Story Bible. Each one waits
            here until you accept, dismiss or defer it.
          </p>
        </Panel>
      ) : (
        <>
          <ReviewFilters summary={summary} values={filters} onChange={changeFilters} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <FindingsList
              page={page}
              selectedId={selected?.id}
              onSelect={setSelected}
              filtered={isFiltered(filters)}
              onClearFilters={() => changeFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
              onShowMore={() => setLimit((current) => current + REVIEW_PAGE_SIZE)}
            />
            <div className="min-w-0">
              {selected ? (
                <FindingDetail
                  // One detail per finding, so a note typed on one never shows on the next; a refreshed finding keeps it.
                  key={selected.id}
                  finding={selected}
                  hasManuscript={hasManuscript}
                  onChanged={changed}
                  goToManuscript={goToManuscript}
                  goToStoryBible={goToStoryBible}
                />
              ) : (
                <Panel>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Select a finding to see its evidence and decide what to do with it.
                  </p>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
