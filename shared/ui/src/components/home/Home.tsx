import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { GuideEntity, ManuscriptChapter, WorkJob } from '../../types';
import type { Bootstrap } from '../../types';
import { Heading } from '../primitives/Heading';
import { AudiobookEstimatePanel } from './AudiobookEstimatePanel';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { WorkDialog } from '../primitives/WorkDialog';

const MIN_IMPORT_ACTIVITY_MS = 450;

function appendLog(logs: string[], line: string) {
  return logs.includes(line) ? logs : [...logs, line];
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
  notify: (text: string) => void;
  goToManuscript: (chapter: string) => void;
  refreshBootstrap: () => Promise<void>;
}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [entities, setEntities] = useState<GuideEntity[]>([]);
  const found = Boolean(data.manuscript);
  const [importJob, setImportJob] = useState<WorkJob>();
  const [headingLevel, setHeadingLevel] = useState(1);
  useEffect(() => {
    void Promise.all([api.manuscriptChapters(), api.guideEntities()])
      .then(([nextChapters, nextEntities]) => {
        setChapters(nextChapters);
        setEntities(nextEntities);
      })
      .catch(() => {});
  }, [api, data.manuscript?.id, data.manuscript?.importedAt]);
  useEffect(() => {
    if (!importJob?.id || importJob.phase !== 'preparing') return;
    let active = true;
    const refresh = () =>
      void api
        .manuscriptImportState(importJob.id!)
        .then((next) => {
          if (active) setImportJob(next);
        })
        .catch(
          (error) => active && setImportJob((current) => (current ? { ...current, phase: 'error', error: String(error), message: String(error) } : current)),
        );
    // A picker/import can finish before the browser gets a frame.  Delay the
    // first read just enough for the progress and activity panel to be useful
    // rather than flashing past it on local SSDs.
    let timer: number | undefined;
    const firstRefresh = window.setTimeout(() => {
      refresh();
      timer = window.setInterval(refresh, 250);
    }, MIN_IMPORT_ACTIVITY_MS);
    return () => {
      active = false;
      window.clearTimeout(firstRefresh);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [api, importJob?.id, importJob?.phase]);
  const commitImport = async () => {
    if (!importJob?.id) return;
    const startedAt = Date.now();
    setImportJob((current) =>
      current
        ? {
            ...current,
            phase: 'committing',
            percent: 12,
            message: 'Writing the project-owned manuscript…',
            logs: appendLog(current.logs, 'Writing the project-owned manuscript…'),
          }
        : current,
    );
    try {
      const completed = await api.manuscriptImportCommit(importJob.id, Boolean(importJob.requiresReset));
      // Refresh the shared application state as soon as the server confirms
      // the transaction.  This updates Home and pages reached afterwards
      // without disrupting the completed activity panel.
      await refreshBootstrap();
      const remaining = MIN_IMPORT_ACTIVITY_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      setImportJob(completed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportJob((current) => (current ? { ...current, phase: 'error', error: message, message } : current));
    }
  };
  const words = chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  const review = entities.find((entity) => entity.review_state === 'unreviewed' || entity.category === 'Needs Review');
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Heading title="Welcome back">
        Project folder: <span className="f-mono">…/{data.projectName}/</span>
      </Heading>
      <section className="panel panel-body flex flex-wrap items-center justify-between gap-3" style={!found ? { borderColor: 'var(--review)' } : undefined}>
        <div className="flex items-center gap-2 text-sm">
          <span className="size-2 flex-none rounded-full" style={{ background: found ? 'var(--character)' : 'var(--review)' }} />
          <span>
            {found ? (
              <>
                <strong>Manuscript found</strong> — {words.toLocaleString()} words across {chapters.length} chapters
              </>
            ) : (
              <>
                <strong>No imported manuscript</strong> — import a Word, Markdown, or text-based PDF manuscript
              </>
            )}
          </span>
        </div>
        <div className="flex gap-2">
          {found && (
            <button className="btn btn-ghost text-xs" onClick={() => go('/manuscript')}>
              View manuscript →
            </button>
          )}
          <button
            className={found ? 'btn btn-ghost text-xs' : 'btn btn-primary text-xs'}
            onClick={async () => {
              const result = await api.selectManuscript();
              if (result.selected && result.jobId)
                setImportJob({
                  id: result.jobId,
                  kind: 'manuscript_import',
                  phase: 'preparing',
                  message: 'Preparing manuscript import…',
                  percent: 0,
                  logs: [],
                  elapsed: 0,
                });
              else notify('No manuscript selected');
            }}
          >
            {found ? 'Replace manuscript…' : 'Import manuscript…'}
          </button>
          {!found && data.legacyManuscriptAvailable && (
            <button
              className="btn btn-ghost text-xs"
              onClick={() =>
                void api
                  .manuscriptLegacyPreview()
                  .then(
                    (result) =>
                      result.jobId &&
                      setImportJob({
                        id: result.jobId,
                        kind: 'manuscript_import',
                        phase: 'preparing',
                        message: 'Preparing manuscript import…',
                        percent: 0,
                        logs: [],
                        elapsed: 0,
                      }),
                  )
                  .catch((error) => notify(error.message))
              }
            >
              Import legacy Word file…
            </button>
          )}
        </div>
      </section>
      {importJob?.phase === 'ready' && importJob.preview && (
        <ConfirmDialog
          title={`Import ${importJob.preview.sourceName}`}
          body={`${importJob.preview.format.toUpperCase()} · ${importJob.preview.paragraphCount} paragraphs · ${importJob.preview.chapterTitles.length || 1} proposed chapters.${importJob.requiresReset ? ' This replaces the active manuscript and clears Story Bible, notes, bookmarks, statuses, and saved comparison results.' : ''}`}
          confirmLabel={importJob.requiresReset ? 'Replace and reset' : 'Import'}
          confirm={() => void commitImport()}
          cancel={() =>
            void api
              .manuscriptImportCancel(importJob.id!)
              .then(() => setImportJob(undefined))
              .catch((error) => notify(error.message))
          }
        >
          {importJob.preview.format === 'markdown' && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              Markdown chapter heading level
              <select
                value={headingLevel}
                onChange={(event) => {
                  const level = Number(event.target.value);
                  setHeadingLevel(level);
                  void api
                    .manuscriptImportPreview(importJob.id!, level)
                    .then(setImportJob)
                    .catch((error) => notify(error.message));
                }}
              >
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <option key={level} value={level}>
                    H{level}
                  </option>
                ))}
              </select>
            </label>
          )}
          {importJob.preview.format === 'pdf' && importJob.preview.chapterTitles.length > 0 && (
            <p className="mt-3 text-xs">Detected chapters: {importJob.preview.chapterTitles.join(' · ')}</p>
          )}
          <div className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="section-label mb-1.5">Preview activity</div>
            <div className="progressbar">
              <div style={{ width: `${importJob.percent}%` }} />
            </div>
            <div className="run-log f-mono mt-2">
              {importJob.logs.map((line, index) => (
                <div key={`${index}-${line}`} className="run-log-entry">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </ConfirmDialog>
      )}
      {importJob && importJob.phase !== 'ready' && (
        <WorkDialog
          title="Import manuscript"
          job={importJob}
          cancel={importJob.phase === 'preparing' ? () => void api.manuscriptImportCancel(importJob.id!).then(() => setImportJob(undefined)) : undefined}
          close={() => setImportJob(undefined)}
        />
      )}
      <AudiobookEstimatePanel
        notify={notify}
        goToManuscript={goToManuscript}
        refreshKey={data.manuscript ? `${data.manuscript.id}:${data.manuscript.importedAt}` : 'no-manuscript'}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <button aria-label="Open Proofing" className="panel panel-body text-left transition hover:-translate-y-px" onClick={() => go('/proofing')}>
          <div className="mb-1 flex items-center justify-between">
            <span className="section-label">Proofing</span>
            <span className="badge" style={{ background: 'var(--review-soft)', color: 'var(--review)' }}>
              2 discrepancies
            </span>
          </div>
          <div className="font-semibold">Continue reviewing the last take</div>
          <div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Track 3 — “Ch.1 take 4” · run today
          </div>
        </button>
        <button aria-label="Open Story Bible" className="panel panel-body text-left transition hover:-translate-y-px" onClick={() => go('/story-bible')}>
          <div className="mb-1 flex items-center justify-between">
            <span className="section-label">Story Bible</span>
            <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {entities.length} entities · {review ? 1 : 0} review
            </span>
          </div>
          <div className="font-semibold">{review ? `Review “${review.canonical_name}”` : 'Story Bible is up to date'}</div>
          <div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {review?.description.text || 'Build the Story Bible to discover names and terms.'}
          </div>
        </button>
      </div>
    </div>
  );
}
