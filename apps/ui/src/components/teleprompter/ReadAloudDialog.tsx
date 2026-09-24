import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Dialog } from '../primitives/Dialog';
import { ReadAlongView } from './ReadAlongView';
import { ResumePrompt } from './ResumePrompt';
import { ReaderRail } from './ReaderRail';
import type { FlagSaveState } from './ReaderFlagsPanel';
import { flagMarks, flagSaves, flagText, visibleFlags, withMarks, type FlagVisibility } from './readerFlags';
import { readerMarks, type ReaderMark, type ReaderMarkTarget, type ReaderRow } from './readerModel';
import { loadFlagVisibility, loadRailState, saveFlagVisibility, saveRailState, type RailState } from './readerPreferences';
import { errorText, useTeleprompterSession } from './useTeleprompterSession';
import type { GuideEntity, ManuscriptChapter, ManuscriptNote, TeleprompterFlag, TeleprompterScript } from '../../types';

const NO_ENTITIES: GuideEntity[] = [];
const NO_NOTES: ManuscriptNote[] = [];
const NO_MARKS = new Map<string, ReaderMark[]>();
const NO_DISMISSED: ReadonlySet<number> = new Set();

/** Flags the narrator dismissed, by id, for one session: flag ids restart at 1 with each script, so a new session starts clear. */
type Dismissal = { script: TeleprompterScript | null; ids: ReadonlySet<number> };

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
 * `ReadAlongView`), opened already pointed at one chapter, so there is no chapter picker here. The resume prompt in the
 * text column's header slot is `ResumePrompt` (read-aloud-resume-from-daw.prd.md Phase 1).
 *
 * Phase 5 adds the story bible and note marks and the side rail (Key, Notes, Story bible) they open in; Phase 7 adds the
 * suspected flags, their Flags tab and keeping them as findings (`useKeptFlags`, ADR 0117). Opening a mark only changes the rail: it never seeks the tracker, moves the highlight or scrolls the text. The rail's open state and
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

  const { paragraphs, rows } = session;
  const { script, flags } = session.session;
  const [visibility, setVisibility] = useState<FlagVisibility>(loadFlagVisibility);
  const [dismissal, setDismissal] = useState<Dismissal>({ script: null, ids: NO_DISMISSED });
  const dismissed = dismissal.script === script ? dismissal.ids : NO_DISMISSED;
  const storyMarks = useMemo(() => (paragraphs ? readerMarks(paragraphs, entities, notes) : NO_MARKS), [paragraphs, entities, notes]);
  const shownFlags = useMemo(() => visibleFlags(flags, visibility, dismissed), [flags, visibility, dismissed]);
  const marks = useMemo(() => withMarks(storyMarks, flagMarks(rows, shownFlags)), [storyMarks, rows, shownFlags]);
  const chapterEntities = useMemo(() => markedEntities(storyMarks), [storyMarks]);
  const keepFlags = useKeptFlags(chapter.id, rows, flags, dismissed, (ids) => setDismissal({ script, ids: new Set([...dismissed, ...ids]) }));
  const chapterNotes = useMemo(() => [...notes].sort(byReadingOrder), [notes]);
  // A flag opened in an earlier session is not this session's (its ids start again at 1).
  const current = selected?.kind === 'flag' && !flags.includes(selected.flag) ? undefined : selected;

  useEffect(() => saveRailState(rail), [rail]);
  useEffect(() => saveFlagVisibility(visibility), [visibility]);
  // Stable, so the memoized rows of `ReaderText` are not all re-rendered on every paced step.
  const openMark = useCallback((mark: ReaderMark) => {
    setSelected(mark.value);
    setRail({ open: true, tab: mark.value.kind === 'note' ? 'notes' : mark.value.kind === 'flag' ? 'flags' : 'bible' });
  }, []);

  // A session that ends while the dialog is open (Stop, the sidecar stopping, auto-stop at Done) keeps its flags then: by the
  // time the host reports it stopped, the sidecar's last flags have arrived. It also resets the start word to the top
  // (read-aloud-resume-from-daw.prd.md Phase 1, ADR 0112): the resume prompt does not come back to ask again, so the next
  // Start must not silently reuse a stale choice from the session that just ended.
  const wasActive = useRef(session.active);
  const { keep } = keepFlags;
  const { setStartWord } = session;
  useEffect(() => {
    if (wasActive.current && !session.active) {
      keep();
      setStartWord(null);
    }
    wasActive.current = session.active;
  }, [session.active, keep, setStartWord]);

  // A dismissal during a session is kept with the rest when the session ends; after it has ended, it is kept at once, so the
  // finding is dismissed in the store rather than deleted (ADR 0117).
  const dismiss = (flag: TeleprompterFlag) => {
    const ids = new Set([...dismissed, flag.id]);
    setDismissal({ script, ids });
    if (!session.active) keepFlags.keep(ids);
  };

  const requestClose = () => {
    if (session.active) {
      setConfirmClose(true);
      return;
    }
    keepFlags.keep();
    onClose();
  };
  const stopAndClose = () => {
    session.stop();
    keepFlags.keep();
    setConfirmClose(false);
    onClose();
  };

  return (
    <>
      <Dialog title={`Read aloud — ${chapter.title}`} size="full" onClose={requestClose} actions={null}>
        <ReadAlongView
          session={session}
          // The resume prompt (read-aloud-resume-from-daw.prd.md Phase 1) sits in the text column's header slot, on the
          // text's own axis (read-aloud-control-bar.prd.md Phase 1): mounted for the dialog's whole life, not remounted
          // between sessions, so it settles once (on a choice or a session starting) and stays gone.
          header={<ResumePrompt chapterId={chapter.id} model={session.model} active={session.active} onStartWord={session.setStartWord} />}
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
              selected={current}
              onSelect={setSelected}
              flagPanel={{
                flags,
                visibility,
                onVisibility: (kind, shown) => setVisibility((current) => ({ ...current, [kind]: shown })),
                dismissed,
                onDismiss: dismiss,
                textOf: (flag) => flagText(rows, flag),
                save: keepFlags.state,
              }}
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

/**
 * Keeps the session's flags as suspected, unreviewed findings (`TeleprompterSaveFlags`, ADR 0117): when a session ends
 * (Stop, the sidecar stopping on its own, or auto-stop at Done), when the dialog closes, and when a flag is dismissed after the
 * session ended. Saving is idempotent on the host (a repeat is one finding, a dismissal is recorded once), so saving again is
 * safe. A flag an earlier session already dismissed with the same heard text comes back dismissed and is hidden here too.
 */
function useKeptFlags(
  chapterId: string,
  rows: ReaderRow[],
  flags: TeleprompterFlag[],
  dismissed: ReadonlySet<number>,
  onAlreadyDismissed: (ids: number[]) => void,
) {
  const api = useApi();
  const [state, setState] = useState<FlagSaveState>({ status: 'idle' });
  const latest = useRef({ rows, flags, dismissed, onAlreadyDismissed });
  useEffect(() => {
    latest.current = { rows, flags, dismissed, onAlreadyDismissed };
  });

  const keep = useCallback(
    (dismissedNow?: ReadonlySet<number>) => {
      const current = latest.current;
      const { saves, flagIds } = flagSaves(current.rows, current.flags, dismissedNow ?? current.dismissed);
      if (saves.length === 0) return;
      setState({ status: 'saving' });
      api
        .teleprompterSaveFlags(chapterId, saves)
        .then((findings) => {
          const already = flagIds.filter((id, index) => findings[index]?.review.status === 'dismissed' && !(dismissedNow ?? current.dismissed).has(id));
          if (already.length) latest.current.onAlreadyDismissed(already);
          setState({ status: 'saved', count: new Set(flagIds).size });
        })
        .catch((reason) => setState({ status: 'error', message: errorText(reason) }));
    },
    [api, chapterId],
  );
  return { state, keep };
}
