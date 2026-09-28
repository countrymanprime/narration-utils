import type { ManuscriptChapter } from '../../api/contracts/manuscript';
import { removalKindLabel, removedWhenLabel } from './chapterRemovalText';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';

/**
 * "Removed from recording" (chapter-track-link-control.prd.md Phase 3, mockup 07): every chapter reclassified out of
 * narration, with Restore. `chapters` is the caller's full list, already carrying `removedFromRecording`; nothing
 * renders while none are removed.
 */
export function RemovedFromRecordingList({
  chapters,
  restoringId,
  onRestore,
}: {
  chapters: ManuscriptChapter[];
  /** The chapter id `manuscriptSetChapterKind(id, 'narration')` is running for, or '' when none is. */
  restoringId: string;
  onRestore: (chapterId: string) => void;
}) {
  const removed = chapters.filter((chapter) => chapter.removedFromRecording);
  if (removed.length === 0) return null;
  const now = new Date();
  return (
    <Panel title={`Removed from recording (${removed.length})`}>
      <ul className="space-y-2">
        {removed.map((chapter) => (
          <li
            key={chapter.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
          >
            <div className="min-w-0">
              <span className="font-medium">{chapter.title}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {' '}
                · {chapter.wordCount.toLocaleString()} words · removed {chapter.kindChangedAt ? removedWhenLabel(chapter.kindChangedAt, now) : ''} as{' '}
                {removalKindLabel(chapter.contentKind ?? 'reference')}
              </span>
            </div>
            <Button variant="ghost" pending={restoringId === chapter.id} onClick={() => onRestore(chapter.id)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
