import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import type { Finding, FindingsPage, FindingsSummary, ManuscriptChapter, TakeComparisonJob, TakeReviewScanJob } from '../../types';
import { chapterName } from '../../chapterName';
import { LoadError } from '../layout/LoadError';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import type { Notify } from '../primitives/Toast';
import { FindingDetail } from './FindingDetail';
import { FindingsList } from './FindingsList';
import { ReviewFilters } from './ReviewFilters';
import { EMPTY_FILTERS, isFiltered, queryFor, REVIEW_PAGE_SIZE, type ReviewFilterValues } from './reviewQuery';
import { STATUS_LABELS } from './findingFormat';
import { TakeReviewScanDialog } from './TakeReviewScanDialog';
import { useReaperStatus } from './useReaperStatus';

const countsLine = (summary: FindingsSummary): string =>
  (['unreviewed', 'accepted', 'dismissed', 'deferred'] as const).map((status) => `${summary[status]} ${STATUS_LABELS[status].toLowerCase()}`).join(' · ');

/**
 * Proof, the book level (stage-navigation-and-page-replacement.prd.md Phase 5, mock 04; the Review page of
 * review-dashboard-and-findings-adoption.prd.md at its new address): every analyzer's notes in one queue, filtered
 * and sorted by the host, drawn as mock 04's notes table, with a note's evidence and the narrator's decision beside
 * it. A chapter opens its chapter view (`/proof/:chapterId`), where the recording plays against the script and
 * Transcript Compare runs. Find pickups and duplicates (take review Phase 5) starts that analyzer's scan here, and its
 * groups are reviewed here like every other note.
 */
export function ProofPage({
  notify,
  hasManuscript,
  goToManuscript,
  goToStoryBible,
  goToWorkspace,
  goToDelivery,
  openChapter,
}: {
  notify: Notify;
  hasManuscript: boolean;
  goToManuscript: (chapter: string, paragraph?: number) => void;
  goToStoryBible: (entityId: string) => void;
  /** "Open in workspace" (edit-and-proof-workspace.prd.md Phase 4): threaded straight through to FindingDetail. */
  goToWorkspace?: (chapterId: string, findingId: string) => void;
  /** Opens the Delivery page on a measured file and rule, for a delivery finding (delivery-platform-profiles.prd.md P12). */
  goToDelivery: (file: string, rule?: string) => void;
  /** Opens a chapter's view, `/proof/:chapterId`. */
  openChapter: (chapterId: string) => void;
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
  const reaper = useReaperStatus();
  const [scanning, setScanning] = useState(false);
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [chapterChoice, setChapterChoice] = useState('');

  // The chapter picker's list: the narration chapters, the ones with a recording to proof (front and back matter have none).
  useEffect(() => {
    if (!hasManuscript) return;
    let active = true;
    api
      .manuscriptChapters()
      .then((all) => active && setChapters(all.filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration')))
      .catch((error) => active && notify(describeApiError(error), 'error'));
    return () => {
      active = false;
    };
  }, [api, hasManuscript, notify]);

  // A pickup and duplicate scan or a take comparison left running in the background saves its findings when it ends: the list is
  // read again then.
  useEffect(
    () =>
      api.subscribeJobEnded((event) => {
        if ((event.kind === 'take_review' || event.kind === 'take_comparison') && event.outcome === 'success') setReloadKey((key) => key + 1);
      }),
    [api],
  );

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

  // A scan that found something shows its groups: the list is narrowed to take review, which Clear filters undoes.
  const scanClosed = (ended?: TakeReviewScanJob) => {
    setScanning(false);
    if (ended?.phase !== 'success') return;
    if (ended.found > 0) changeFilters({ ...EMPTY_FILTERS, analyzer: 'take-review', sort: filters.sort });
    else setReloadKey((key) => key + 1);
  };

  // A finished comparison is shown straight away: the list is narrowed to take comparisons and the new one is opened beside it.
  const compared = (ended: TakeComparisonJob) => {
    const id = ended.comparisonId;
    changeFilters({ ...EMPTY_FILTERS, analyzer: 'take-comparison', sort: filters.sort });
    if (!id) return;
    api.findingsGet(id).then(setSelected, (error) => notify(describeApiError(error), 'error'));
  };

  const retry = () => {
    setLoadError(undefined);
    setReloadKey((key) => key + 1);
  };

  if (loadError) return <LoadError title="Proof" message={loadError} retry={retry} />;

  const nothingYet = summary !== undefined && summary.total === 0 && summary.notInLatestRun === 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading title="Proof">{summary && !nothingYet ? countsLine(summary) : undefined}</Heading>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chapters.length > 0 && (
            <>
              <Select
                label="Chapter to open"
                value={chapterChoice}
                onChange={setChapterChoice}
                options={[{ value: '', label: 'Choose a chapter…' }, ...chapters.map((chapter) => ({ value: chapter.id, label: chapterName(chapter) }))]}
              />
              <Button variant="ghost" disabled={!chapterChoice} onClick={() => openChapter(chapterChoice)}>
                Open chapter
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setScanning(true)}>
            Find pickups and duplicates…
          </Button>
        </div>
      </div>
      {nothingYet ? (
        <Panel title="No notes yet">
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Notes appear here when a check has something for you to look at: open a chapter and compare its recording with the script, build the Story Bible, or
            find pickups and duplicates on a track. Each one waits here until you accept, dismiss or defer it.
          </p>
        </Panel>
      ) : (
        <>
          <ReviewFilters summary={summary} values={filters} onChange={changeFilters} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
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
                  goToWorkspace={goToWorkspace}
                  goToDelivery={goToDelivery}
                  reaperStatus={reaper.status}
                  onReaperStatusChange={reaper.refresh}
                  onCompared={compared}
                />
              ) : (
                <Panel>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Select a note to see its evidence and decide what to do with it.
                  </p>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
      {scanning && <TakeReviewScanDialog onClose={scanClosed} />}
    </div>
  );
}
