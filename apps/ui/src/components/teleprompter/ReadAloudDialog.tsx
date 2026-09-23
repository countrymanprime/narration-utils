import { useState } from 'react';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Dialog } from '../primitives/Dialog';
import { ReadAlongView } from './ReadAlongView';
import { ResumeCard } from './ResumeCard';
import { useTeleprompterSession } from './useTeleprompterSession';
import type { ManuscriptChapter } from '../../types';

type Props = {
  chapter: Pick<ManuscriptChapter, 'id' | 'title' | 'subtitle'>;
  onClose: () => void;
};

/**
 * Reading mode as a Manuscript chapter action (teleprompter-manuscript-integration.prd.md Phase 2): a full-size
 * `Dialog` around the same session core and reader view the standalone Teleprompter page uses (`useTeleprompterSession`,
 * `ReadAlongView`), opened already pointed at one chapter, so there is no chapter picker here. This phase covers only
 * start/stop; seek, marks, flags and punch are other phases (3-12). The resume card above the view is Phase 10's
 * (`ResumeCard`).
 *
 * Closing while a session is active stops it first (the PRD's Open Questions, "Closing the modal during a live
 * session", recommendation (a)): an orphaned live microphone capture is a privacy and CPU surprise, so a confirm asks
 * first rather than silently stopping or silently leaving it running.
 */
export function ReadAloudDialog({ chapter, onClose }: Props) {
  const session = useTeleprompterSession({ chapterId: chapter.id, chapter, migrateLegacyDevice: false });
  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = () => {
    if (session.active) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };
  const stopAndClose = () => {
    session.stop();
    setConfirmClose(false);
    onClose();
  };

  return (
    <>
      <Dialog title={`Read aloud — ${chapter.title}`} size="full" onClose={requestClose} actions={null}>
        {/* The resume card (Phase 10) sits above the reading view between sessions only; a running session moves by word click. */}
        {!session.active && (
          <div className="mx-auto mb-4 max-w-3xl">
            <ResumeCard chapterId={chapter.id} model={session.model} onStartWord={session.setStartWord} />
          </div>
        )}
        <ReadAlongView session={session} />
      </Dialog>
      {confirmClose && (
        <ConfirmDialog
          title="Stop reading?"
          body="Reading is still listening. Closing stops it; nothing recorded in REAPER is affected."
          confirmLabel="Stop and close"
          confirm={stopAndClose}
          cancel={() => setConfirmClose(false)}
        />
      )}
    </>
  );
}
