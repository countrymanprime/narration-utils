import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { GuideEntity, ManuscriptChapter, ManuscriptImportSelection } from '../../types';
import type { Bootstrap } from '../../types';
import { Heading } from '../primitives/Heading';
import { AudiobookEstimatePanel } from './AudiobookEstimatePanel';
import { ConfirmDialog } from '../primitives/ConfirmDialog';

export function Home({
  data,
  go,
  notify,
  goToManuscript,
}: {
  data: Bootstrap;
  go: (page: string) => void;
  notify: (text: string) => void;
  goToManuscript: (chapter: string) => void;
}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [entities, setEntities] = useState<GuideEntity[]>([]);
  const found = Boolean(data.manuscript);
  const [pendingImport, setPendingImport] = useState<ManuscriptImportSelection>();
  const [headingLevel, setHeadingLevel] = useState(1);
  useEffect(() => {
    void Promise.all([api.manuscriptChapters(), api.guideEntities()])
      .then(([nextChapters, nextEntities]) => {
        setChapters(nextChapters);
        setEntities(nextEntities);
      })
      .catch(() => {});
  }, [api]);
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
          {found && <button className="btn btn-ghost text-xs" onClick={() => go('/manuscript')}>View manuscript →</button>}
          <button
            className={found ? 'btn btn-ghost text-xs' : 'btn btn-primary text-xs'}
            onClick={async () => {
              const result = await api.selectManuscript();
              if (result.selected) setPendingImport(result);
              else notify('No manuscript selected');
            }}
          >
            {found ? 'Replace manuscript…' : 'Import manuscript…'}
          </button>
          {!found && data.legacyManuscriptAvailable && <button className="btn btn-ghost text-xs" onClick={() => void api.manuscriptLegacyPreview().then(setPendingImport).catch((error) => notify(error.message))}>Import legacy Word file…</button>}
        </div>
      </section>
      {pendingImport?.preview && (
        <ConfirmDialog
          title={`Import ${pendingImport.preview.sourceName}`}
          body={`${pendingImport.preview.format.toUpperCase()} · ${pendingImport.preview.paragraphCount} paragraphs · ${pendingImport.preview.chapterTitles.length || 1} proposed chapters.${pendingImport.requiresReset ? ' This replaces the active manuscript and clears Story Bible, notes, bookmarks, statuses, and saved comparison results.' : ''}`}
          confirmLabel={pendingImport.requiresReset ? 'Replace and reset' : 'Import'}
          confirm={() => {
            void api.manuscriptImportCommit(headingLevel, Boolean(pendingImport.requiresReset)).then(() => {
              setPendingImport(undefined);
              notify('Manuscript imported.');
              location.reload();
            }).catch((error) => notify(error.message));
          }}
          cancel={() => setPendingImport(undefined)}
        >
          {pendingImport.preview.format === 'markdown' && (
            <label className="mt-4 flex items-center gap-2 text-sm">Markdown chapter heading level
              <select value={headingLevel} onChange={(event) => {
                const level = Number(event.target.value);
                setHeadingLevel(level);
                void api.manuscriptImportPreview(level).then(setPendingImport).catch((error) => notify(error.message));
              }}>
                {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>H{level}</option>)}
              </select>
            </label>
          )}
          {pendingImport.preview.format === 'pdf' && pendingImport.preview.chapterTitles.length > 0 && <p className="mt-3 text-xs">Detected chapters: {pendingImport.preview.chapterTitles.join(' · ')}</p>}
        </ConfirmDialog>
      )}
      <AudiobookEstimatePanel notify={notify} goToManuscript={goToManuscript} />
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
