import type { ChapterSyncPreview } from '../../api/contracts/chapterSync';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { chapterSyncNotChaptersText, chapterSyncReasonText } from './chapterSyncText';

/**
 * "Sync chapters to tracks?" (daw-chapter-track-auto-sync.prd.md Phase 3, mockup 01): shown once per project, the
 * moment `chapterSyncState().ask` is true (a manuscript and a linked DAW project, consent undecided), from every
 * link path. `preview` is `chapterSyncPreview()`'s answer, loaded by the caller; undefined while it is still loading.
 */
export function ChapterSyncConsentDialog({
  projectFile,
  preview,
  busy,
  onSync,
  onNotNow,
}: {
  projectFile: string;
  preview: ChapterSyncPreview | undefined;
  busy: boolean;
  onSync: () => void;
  onNotNow: () => void;
}) {
  const notChapters = preview ? chapterSyncNotChaptersText(preview.unmatched, preview.pickupTracks) : undefined;
  return (
    <Dialog
      title="Sync chapters to tracks?"
      variant="alert"
      description={`${projectFile} is now linked. The app can tie each chapter to its REAPER track by name, and keep them in step as you add tracks. It only reads the saved project; nothing in REAPER changes. Chapters you linked yourself are kept.`}
      onClose={busy ? undefined : onNotNow}
      escapeCloses={!busy}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onNotNow}>
            Not now
          </Button>
          <Button pending={busy} onClick={onSync} disabled={!preview}>
            {preview ? `Sync ${preview.autoLink.length} chapters` : 'Sync chapters'}
          </Button>
        </>
      }
    >
      {!preview ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Reading the saved project…
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <section>
            <h3 className="section-label mb-1">Will be linked ({preview.autoLink.length})</h3>
            {preview.autoLink.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>None yet.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {preview.autoLink.map((link) => (
                  <li key={link.trackGuid} className="truncate">
                    {link.trackName} → {link.chapterTitle}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {preview.needsYou.length > 0 && (
            <section>
              <h3 className="section-label mb-1">Needs you ({preview.needsYou.length})</h3>
              <ul className="space-y-1">
                {preview.needsYou.map((item) => (
                  <li key={item.chapterId}>
                    <span className="font-semibold">{item.chapterTitle}</span>: {chapterSyncReasonText(item)}
                  </li>
                ))}
              </ul>
              <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                You choose these after syncing, on Tracks or from the chapter&rsquo;s track button on Home.
              </p>
            </section>
          )}
          {preview.noTrack.length > 0 && (
            <section>
              <h3 className="section-label mb-1">Chapters with no track yet ({preview.noTrack.length})</h3>
              <p>{preview.noTrack.map((chapter) => chapter.chapterTitle).join(', ')}</p>
            </section>
          )}
          {notChapters && notChapters.names !== 'None.' && (
            <section>
              <h3 className="section-label mb-1">Tracks that are not chapters</h3>
              <p>{notChapters.names}</p>
              {notChapters.note && (
                <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {notChapters.note}
                </p>
              )}
            </section>
          )}
          <p style={{ color: 'var(--text-muted)' }}>You can turn chapter sync on or off later on Tracks.</p>
        </div>
      )}
    </Dialog>
  );
}
