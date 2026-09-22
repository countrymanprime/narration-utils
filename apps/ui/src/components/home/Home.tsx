import { apiErrorMessage, describeApiError } from '../../api/errorMessage';
import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileArrowUp, faFileLines } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { GuideEntity, ManuscriptImportSelection, TranscriptState, WorkJob } from '../../types';
import type { Bootstrap } from '../../types';
import { Heading } from '../primitives/Heading';
import { AudiobookEstimatePanel } from './AudiobookEstimatePanel';
import { ImportReview, ImportSummary } from './ImportReview';
import type { ReviewGroupKey, ReviewGroupOpen } from './importReviewModel';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { WorkDialog } from '../primitives/WorkDialog';
import { TooltipTarget } from '../primitives/Tooltip';
import { IconButton } from '../primitives/IconButton';
import type { Notify } from '../primitives/Toast';

// Import runs as a host-side job; the UI only ever displays the percent and log
// lines the host reports while polling (ADR-0015) - it never invents progress.
const IMPORT_POLL_MS = 200;
// Candidate manuscripts the user has said no to. Module scope, not storage, so a
// declined offer stays quiet for the rest of the session and is offered again
// the next time the app starts (ADR-0019).
const declinedCandidates = new Set<string>();
const POLLED_PHASES: WorkJob['phase'][] = ['preparing', 'committing'];

function completedLabel(value?: string) {
  if (!value) return 'completed previously';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'completed previously' : `completed ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function Home({
  data,
  go,
  notify,
  goToManuscript,
  refreshBootstrap,
}: {
  data: Bootstrap;
  go: (page: string) => void;
  notify: Notify;
  goToManuscript: (chapter: string) => void;
  refreshBootstrap: () => Promise<void>;
}) {
  const api = useApi();
  const [entities, setEntities] = useState<GuideEntity[]>([]);
  const [lastCompleted, setLastCompleted] = useState<TranscriptState>();
  const found = Boolean(data.manuscript);
  const [importJob, setImportJob] = useState<WorkJob>();
  // The file dialog is the host's, and pressing again while it is open would open a second one (ADR 0075).
  const choosing = usePendingAction();
  const [importSelection, setImportSelection] = useState<ManuscriptImportSelection>({});
  // Which review groups the narrator opened or closed by hand. It lives here, above the review dialog, which is swapped for a progress
  // dialog while a Markdown heading level is read again, and is reset only when a new file is chosen (a group has its own default until then).
  const [groupOpen, setGroupOpen] = useState<ReviewGroupOpen>({});
  const [headingLevel, setHeadingLevel] = useState(1);
  const [, setDeclineCount] = useState(0);
  const candidate = data.manuscriptCandidate;
  const offerCandidate = !found && candidate && !declinedCandidates.has(candidate.path) && !importJob;
  useEffect(() => {
    void api
      .guideEntities()
      .then(setEntities)
      .catch(() => {});
    void api
      .transcriptLastCompleted()
      .then(setLastCompleted)
      .catch(() => setLastCompleted(undefined));
  }, [api, data.manuscript?.id, data.manuscript?.importedAt]);
  useEffect(() => {
    if (!importJob?.id || !POLLED_PHASES.includes(importJob.phase)) return;
    let active = true;
    const refresh = () =>
      void api
        .manuscriptImportState(importJob.id!)
        .then((next) => {
          if (active) setImportJob(next);
        })
        .catch(
          (error) =>
            active &&
            setImportJob((current) => (current ? { ...current, phase: 'error', error: describeApiError(error), message: describeApiError(error) } : current)),
        );
    refresh();
    const timer = window.setInterval(refresh, IMPORT_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, importJob?.id, importJob?.phase]);
  // The host finishes writing the manuscript before it reports success, so the
  // shared application state is refreshed exactly once, on that transition.
  useEffect(() => {
    if (importJob?.phase === 'success') void refreshBootstrap();
  }, [importJob?.phase, refreshBootstrap]);
  const beginImportPreview = async (jobId: string) => {
    setHeadingLevel(1);
    setImportSelection({});
    setGroupOpen({});
    setImportJob({ id: jobId, kind: 'manuscript_import', phase: 'preparing', message: 'Preparing manuscript import…', percent: 0, logs: [], elapsed: 0 });
    try {
      setImportJob(await api.manuscriptImportPreview(jobId, { markdownHeadingLevel: 1 }));
    } catch (error) {
      const message = apiErrorMessage(error);
      setImportJob((current) => (current ? { ...current, phase: 'error', error: message, message } : current));
    }
  };
  // Another Markdown heading level means other sections, so the choices made for the old ones are dropped and the host reads the file again.
  const changeHeadingLevel = (level: number) => {
    setHeadingLevel(level);
    setImportSelection({});
    void api
      .manuscriptImportPreview(importJob!.id!, { markdownHeadingLevel: level })
      .then(setImportJob)
      .catch((error) => notify(error.message, 'error'));
  };
  const commitImport = async () => {
    if (!importJob?.id) return;
    try {
      const selectedCharacterCandidateIds =
        importSelection.characterCandidateIds ?? importJob.preview?.characterCandidates?.map((candidate) => candidate.id) ?? [];
      // Returns at once: the job is 'committing' and polling shows its real
      // stages, or it is still 'ready' with requiresReset asking for a confirm.
      setImportJob(
        await api.manuscriptImportCommit(importJob.id, {
          confirmedReset: Boolean(importJob.requiresReset),
          selection: { sectionKinds: importSelection.sectionKinds, characterCandidateIds: selectedCharacterCandidateIds },
        }),
      );
    } catch (error) {
      const message = apiErrorMessage(error);
      setImportJob((current) => (current ? { ...current, phase: 'error', error: message, message } : current));
    }
  };
  const review = entities.find(
    (entity) => entity.review_state === 'needs review' || entity.review_state === 'unreviewed' || entity.category === 'Needs Review',
  );
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Heading title="Welcome back">
        Project folder: <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">…/{data.projectName}/</span>
      </Heading>
      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] shadow-[var(--shadow)]"
        style={!found ? { borderColor: 'var(--review)' } : undefined}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="size-2 flex-none rounded-full" style={{ background: found ? 'var(--character)' : 'var(--review)' }} />
          <span>
            {found ? (
              <>
                <strong>Manuscript found</strong> — {data.manuscript!.narratableWordCount.toLocaleString()} words across{' '}
                {data.manuscript!.narratableChapterCount} narratable chapters
              </>
            ) : (
              <>
                <strong>No imported manuscript</strong> — import a Word or Markdown manuscript
              </>
            )}
          </span>
        </div>
        <div className="flex gap-2">
          {found && (
            <TooltipTarget text="View manuscript">
              <IconButton label="View manuscript" onClick={() => go('/manuscript')}>
                <FontAwesomeIcon icon={faFileLines} />
              </IconButton>
            </TooltipTarget>
          )}
          <TooltipTarget
            text={
              found
                ? 'Replace manuscript — confirmation clears Story Bible, notes, bookmarks, chapter statuses, and saved proofing results.'
                : 'Import manuscript'
            }
          >
            <IconButton
              label={found ? 'Replace manuscript' : 'Import manuscript'}
              pending={choosing.isPending('choose')}
              onClick={() =>
                void choosing.run('choose', async () => {
                  try {
                    const result = await api.selectManuscript();
                    if (result.selected && result.jobId) {
                      setImportSelection({});
                      void beginImportPreview(result.jobId);
                    } else notify('No manuscript selected');
                  } catch (error) {
                    notify(describeApiError(error), 'error');
                  }
                })
              }
            >
              <FontAwesomeIcon icon={faFileArrowUp} />
            </IconButton>
          </TooltipTarget>
        </div>
      </section>
      {offerCandidate && (
        <ConfirmDialog
          title="Import manuscript?"
          body={`Found ${candidate.name} in this project folder. Import it now? You can also choose a different file with the import button.`}
          confirmLabel="Import"
          confirm={() =>
            void api
              .manuscriptBeginImport(candidate.path)
              .then((result) => (result.selected && result.jobId ? beginImportPreview(result.jobId) : undefined))
              .catch((error) => notify(describeApiError(error), 'error'))
          }
          cancel={() => {
            declinedCandidates.add(candidate.path);
            setDeclineCount((count) => count + 1);
          }}
        />
      )}
      {importJob?.phase === 'ready' && importJob.preview && (
        <ConfirmDialog
          title={`Import ${importJob.preview.sourceName}`}
          body={<ImportSummary preview={importJob.preview} selection={importSelection} requiresReset={Boolean(importJob.requiresReset)} />}
          confirmLabel={importJob.requiresReset ? 'Replace and reset' : 'Import'}
          confirmVariant={importJob.requiresReset ? 'danger' : 'primary'}
          confirm={() => void commitImport()}
          cancel={() =>
            void api
              .manuscriptImportCancel(importJob.id!)
              .then(() => setImportJob(undefined))
              .catch((error) => notify(error.message, 'error'))
          }
        >
          <ImportReview
            preview={importJob.preview}
            selection={importSelection}
            onSelectionChange={setImportSelection}
            headingLevel={headingLevel}
            onHeadingLevelChange={changeHeadingLevel}
            groupOpen={groupOpen}
            onGroupOpenChange={(group: ReviewGroupKey, open: boolean) => setGroupOpen((current) => ({ ...current, [group]: open }))}
          />
        </ConfirmDialog>
      )}
      {importJob && importJob.phase !== 'ready' && (
        <WorkDialog
          title="Import manuscript"
          job={importJob}
          cancel={
            importJob.phase === 'preparing'
              ? () =>
                  void api
                    .manuscriptImportCancel(importJob.id!)
                    .then(() => setImportJob(undefined))
                    .catch((error) => notify(describeApiError(error), 'error'))
              : undefined
          }
          close={() => setImportJob(undefined)}
        />
      )}
      <AudiobookEstimatePanel
        notify={notify}
        goToManuscript={goToManuscript}
        refreshKey={data.manuscript ? `${data.manuscript.id}:${data.manuscript.importedAt}` : 'no-manuscript'}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TooltipTarget text={found ? 'Open Proofing' : 'Import a manuscript to unlock Proofing.'} className="w-full">
          <button
            aria-label="Open Proofing"
            disabled={!found}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] text-left shadow-[var(--shadow)] transition hover:-translate-y-px disabled:pointer-events-none disabled:opacity-50"
            onClick={() => go('/proofing')}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                Proofing
              </span>
              <span
                className="inline-flex items-center gap-[0.35rem] rounded-full px-[0.55rem] py-[0.15rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.03em] uppercase"
                style={
                  lastCompleted
                    ? { background: 'var(--review-soft)', color: 'var(--danger-text)' }
                    : { background: 'var(--surface-2)', color: 'var(--text-muted)' }
                }
              >
                {lastCompleted ? `${lastCompleted.rows.length} ${lastCompleted.rows.length === 1 ? 'discrepancy' : 'discrepancies'}` : 'Ready'}
              </span>
            </div>
            <div className="font-semibold">{lastCompleted ? 'Review latest comparison' : 'Ready to compare selected REAPER audio'}</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {lastCompleted
                ? `${lastCompleted.trackName || 'Selected REAPER audio'}${lastCompleted.audioItemCount ? ` · ${lastCompleted.audioItemCount} audio item${lastCompleted.audioItemCount === 1 ? '' : 's'}` : ''} · ${completedLabel(lastCompleted.completedAt)}`
                : 'Select audio items or a track in REAPER, then start Proofing.'}
            </div>
          </button>
        </TooltipTarget>
        <TooltipTarget text={found ? 'Open Story Bible' : 'Import a manuscript to unlock Story Bible.'} className="w-full">
          <button
            aria-label="Open Story Bible"
            disabled={!found}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] text-left shadow-[var(--shadow)] transition hover:-translate-y-px disabled:pointer-events-none disabled:opacity-50"
            onClick={() => go('/story-bible')}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                Story Bible
              </span>
              <span
                className="inline-flex items-center gap-[0.35rem] rounded-full px-[0.55rem] py-[0.15rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.03em] uppercase"
                style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
              >
                {entities.length} entities · {review ? 1 : 0} review
              </span>
            </div>
            <div className="font-semibold">
              {review ? `Review “${review.canonical_name}”` : entities.length ? 'Browse Story Bible entries' : 'No Story Bible entries yet'}
            </div>
            <div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {review?.description.text ||
                (entities.length
                  ? `${entities.length} saved ${entities.length === 1 ? 'entity' : 'entities'}`
                  : 'Build the Story Bible to discover names and terms.')}
            </div>
          </button>
        </TooltipTarget>
      </div>
    </div>
  );
}
