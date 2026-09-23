import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Dialog } from '../primitives/Dialog';
import { ReadAlongView } from './ReadAlongView';
import { ResumeCard } from './ResumeCard';
import { ReaderRail } from './ReaderRail';
import { readerMarks, type ReaderMark, type ReaderMarkTarget } from './readerModel';
import { loadRailState, saveRailState, type RailState } from './readerPreferences';
import { useTeleprompterSession } from './useTeleprompterSession';
import type { GuideEntity, ManuscriptChapter, ManuscriptNote } from '../../types';

const NO_ENTITIES: GuideEntity[] = [];
const NO_NOTES: ManuscriptNote[] = [];
const NO_MARKS = new Map<string, ReaderMark[]>();

type Props = {
  chapter: Pick<ManuscriptChapter, 'id' | 'title' | 'subtitle'>;
  /** The Story Bible entries the Manuscript page has loaded; the ones this chapter mentions are marked in the text. */
  entities?: GuideEntity[];
  /** This chapter's notes (the Manuscript page filters them to the chapter, as it does for its own reader). */
  notes?: ManuscriptNote[];
  onClose: () => void;
};

/** The entities the marks point at, once each, in the order they first appear in the chapter. */
function markedEntities(marks: Map<string, ReaderMark[]>): GuideEntity[] {
  const seen = new Map<string, GuideEntity>();
  for (const rowMarks of marks.values())
    for (const mark of rowMarks) if (mark.value.kind === 'entity' && !seen.has(mark.value.entity.id)) seen.set(mark.value.entity.id, mark.value.entity);
  return [...seen.values()];
}

const byReadingOrder = (a: ManuscriptNote, b: ManuscriptNote): number => a.paragraph - b.paragraph || (a.anchorStart ?? 0) - (b.anchorStart ?? 0);

/**
 * Reading mode as a Manuscript chapter action (teleprompter-manuscript-integration.prd.md Phase 2): a full-size
 * `Dialog` around the same session core and reader view the standalone Teleprompter page uses (`useTeleprompterSession`,
 * `ReadAlongView`), opened already pointed at one chapter, so there is no chapter picker here. The resume card above the
 * view is Phase 10's (`ResumeCard`).
 *
 * Phase 5 adds the story bible and note marks and the side rail (Key, Notes, Story bible) they open in. Opening a mark
 * only changes the rail: it never seeks the tracker, moves the highlight or scrolls the text. The rail's open state and
 * tab are per-viewer preferences in browser storage (the PRD's Decisions Log); the selection is not kept.
 *
 * Closing while a session is active stops it first (the PRD's Open Questions, "Closing the modal during a live
 * session", recommendation (a)): an orphaned live microphone capture is a privacy and CPU surprise, so a confirm asks
 * first rather than silently stopping or silently leaving it running.
 */
export function ReadAloudDialog({ chapter, entities = NO_ENTITIES, notes = NO_NOTES, onClose }: Props) {
  const session = useTeleprompterSession({ chapterId: chapter.id, chapter, migrateLegacyDevice: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const [rail, setRail] = useState<RailState>(loadRailState);
  const [selected, setSelected] = useState<ReaderMarkTarget>();

  const { paragraphs } = session;
  const marks = useMemo(() => (paragraphs ? readerMarks(paragraphs, entities, notes) : NO_MARKS), [paragraphs, entities, notes]);
  const chapterEntities = useMemo(() => markedEntities(marks), [marks]);
  const chapterNotes = useMemo(() => [...notes].sort(byReadingOrder), [notes]);

  useEffect(() => saveRailState(rail), [rail]);
  // Stable, so the memoized rows of `ReaderText` are not all re-rendered on every paced step.
  const openMark = useCallback((mark: ReaderMark) => {
    setSelected(mark.value);
    setRail({ open: true, tab: mark.value.kind === 'note' ? 'notes' : 'bible' });
  }, []);

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
        <ReadAlongView
          session={session}
          marks={marks}
          onOpenMark={openMark}
          aside={
            <ReaderRail
              state={rail}
              onTab={(tab) => setRail((current) => ({ ...current, tab }))}
              onToggle={() => setRail((current) => ({ ...current, open: !current.open }))}
              seekable={session.active}
              entities={chapterEntities}
              notes={chapterNotes}
              selected={selected}
              onSelect={setSelected}
            />
          }
        />
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
