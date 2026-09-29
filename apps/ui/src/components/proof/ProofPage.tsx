import { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilter } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import type { Finding, FindingsPage, FindingsSummary, ManuscriptChapter, TakeComparisonJob, TakeReviewScanJob } from '../../types';
import { usePickupsState } from '../pickups/usePickupsState';
import { ChapterWaveformCard } from './ChapterWaveformCard';
import { loadLastChapter, saveLastChapter } from './lastChapterStorage';
import { LoadError } from '../layout/LoadError';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { IconButton } from '../primitives/IconButton';
import { Panel } from '../primitives/Panel';
import { Popover } from '../primitives/Popover';
import type { Notify } from '../primitives/Toast';
import { FindingDetail } from './FindingDetail';
import { FindingsList } from './FindingsList';
import { ReviewFilters } from './ReviewFilters';
import { EMPTY_FILTERS, isFiltered, queryFor, REVIEW_PAGE_SIZE, type ReviewFilterValues } from './reviewQuery';
import { NotesHeader, SourcesLine } from './NotesHeader';
import { resolutionCounts, type ResolutionCounts } from './resolution';
import { TakeReviewScanDialog } from './TakeReviewScanDialog';
import { useReaperStatus } from './useReaperStatus';
import { useDawKind } from '../../useDawKind';

// The notes header's chips from the summary's own counts (over the latest run), with the accepted notes split into pickups and
// edits by reading them: the summary counts statuses, and whether an accepted note is a pickup or an edit is the note's own.
function headerCounts(summary: FindingsSummary | undefined, accepted: readonly Finding[]): ResolutionCounts {
  const split = resolutionCounts(accepted);
  return {
    toReview: summary?.unreviewed ?? 0,
    pickup: split.pickup,
    edit: split.edit,
    waived: summary?.dismissed ?? 0,
    deferred: summary?.deferred ?? 0,
  };
}

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
  projectFolder,
  hasManuscript,
  goToManuscript,
  goToStoryBible,
  goToWorkspace,
  goToMaster,
  openChapter,
}: {
  notify: Notify;
  /** Keys the remembered chapter (`lastChapterStorage.ts`). */
  projectFolder: string;
  hasManuscript: boolean;
  goToManuscript: (chapter: string, paragraph?: number) => void;
  goToStoryBible: (entityId: string) => void;
  /** "Open in workspace" (edit-and-proof-workspace.prd.md Phase 4): threaded straight through to FindingDetail. */
  goToWorkspace?: (chapterId: string, findingId: string) => void;
  /** Opens Master & QC on a measured file and rule, for a delivery finding (delivery-platform-profiles.prd.md P12). */
  goToMaster: (file: string, rule?: string) => void;
  /** Opens a chapter's view, `/proof/:chapterId`. */
  openChapter: (chapterId: string) => void;
}) {
  const api = useApi();
  const [summary, setSummary] = useState<FindingsSummary>();
  const [page, setPage] = useState<FindingsPage>();
  const [accepted, setAccepted] = useState<Finding[]>([]);
  const pickups = usePickupsState();
  const [loadError, setLoadError] = useState<string>();
  const [filters, setFilters] = useState<ReviewFilterValues>(EMPTY_FILTERS);
  const [limit, setLimit] = useState(REVIEW_PAGE_SIZE);
  const [selected, setSelected] = useState<Finding>();
  const [reloadKey, setReloadKey] = useState(0);
  const loadedOnce = useRef(false);
  const reaper = useReaperStatus();
  const dawKind = useDawKind();
  const [scanning, setScanning] = useState(false);
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  // The chapter whose waveform the card draws (ADR 0750, D100): the one the notes are filtered to, else the last chapter the
  // narrator looked at in this project, else the first narration chapter.
  const [lastChapter, setLastChapter] = useState(() => loadLastChapter(projectFolder));
  const known = (id: string) => chapters.some((chapter) => chapter.id === id);
  const waveformChapterId = known(filters.chapterId) ? filters.chapterId : known(lastChapter) ? lastChapter : (chapters[0]?.id ?? '');

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
    Promise.all([api.findingsSummary(), api.findingsList(queryFor(filters, limit)), api.findingsList({ status: 'accepted' })])
      .then(([nextSummary, nextPage, acceptedPage]) => {
        if (!active) return;
        loadedOnce.current = true;
        setSummary(nextSummary);
        setPage(nextPage);
        setAccepted(acceptedPage.findings);
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

  // The card's selector also narrows the notes table to that chapter; "Show all chapters" undoes it (ADR 0750, D100).
  const pickChapter = (chapterId: string) => {
    setLastChapter(chapterId);
    saveLastChapter(projectFolder, chapterId);
    changeFilters({ ...filters, chapterId });
  };
  const waveformCard = (
    <ChapterWaveformCard
      chapters={chapters}
      chapterId={waveformChapterId}
      onChapterChange={pickChapter}
      onOpenChapter={openChapter}
      notesFiltered={known(filters.chapterId)}
      onShowAllChapters={() => changeFilters({ ...filters, chapterId: '' })}
    />
  );
  const nothingYet = summary !== undefined && summary.total === 0 && summary.notInLatestRun === 0;

  // Mock 04's header sits over the notes column only: the note's detail column starts at the top of the page beside it.
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <Heading title="Proof" />
        <SourcesLine analyzers={summary?.analyzers ?? []} proofer={pickups.total > 0} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!nothingYet && (
          <Popover
            label="Filter findings"
            side="bottom"
            align="end"
            trigger={
              <IconButton label={isFiltered(filters) ? 'Filters (some are hidden)' : 'Filters'}>
                <FontAwesomeIcon icon={faFilter} />
              </IconButton>
            }
          >
            <div className="w-[34rem] max-w-[90vw]">
              <ReviewFilters summary={summary} values={filters} onChange={changeFilters} />
            </div>
          </Popover>
        )}
        <Button variant="secondary" onClick={() => setScanning(true)}>
          Find pickups and duplicates…
        </Button>
      </div>
    </div>
  );

  if (nothingYet) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        {header}
        {hasManuscript && waveformCard}
        <Panel title="No notes yet">
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Notes appear here when a check has something for you to look at: open a chapter and compare its recording with the script, build the Story Bible, or
            find pickups and duplicates on a track. Each one waits here until you accept, dismiss or defer it.
          </p>
        </Panel>
        {scanning && <TakeReviewScanDialog onClose={scanClosed} />}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {header}
        {hasManuscript && waveformCard}
        <FindingsList
          page={page}
          selectedId={selected?.id}
          onSelect={setSelected}
          filtered={isFiltered(filters)}
          onClearFilters={() => changeFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
          onShowMore={() => setLimit((current) => current + REVIEW_PAGE_SIZE)}
          header={<NotesHeader total={summary?.total ?? 0} counts={headerCounts(summary, accepted)} pickups={pickups} />}
        />
      </div>
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
            goToMaster={goToMaster}
            reaperStatus={reaper.status}
            onReaperStatusChange={reaper.refresh}
            onCompared={compared}
            dawKind={dawKind}
          />
        ) : (
          <Panel>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Select a note to see its evidence and decide what to do with it.
            </p>
          </Panel>
        )}
      </div>
      {scanning && <TakeReviewScanDialog onClose={scanClosed} />}
    </div>
  );
}
