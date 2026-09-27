import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chapterName, context } from '../../chapterName';
import { useApi } from '../../api/ApiContext';
import { CommandScope } from '../../input/router';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Dialog } from '../primitives/Dialog';
import { ReadAlongView } from './ReadAlongView';
import { ReadingControlBar } from './ReadingControlBar';
import { ResumePrompt } from './ResumePrompt';
import { ReaderRail } from './ReaderRail';
import type { FlagSaveState } from './ReaderFlagsPanel';
import { flagMarks, flagSaves, flagText, visibleFlags, withMarks, type FlagVisibility } from './readerFlags';
import { CREDITS_LABEL, readerMarks, type CreditsKind, type ReaderMark, type ReaderMarkTarget, type ReaderRow } from './readerModel';
import { loadFlagVisibility, loadRailState, saveFlagVisibility, saveRailState, type RailState } from './readerPreferences';
import { UnresolvedCreditsWarning } from './UnresolvedCreditsWarning';
import { useFollowCursor } from './useFollowCursor';
import { errorText, useTeleprompterSession } from './useTeleprompterSession';
import type { CreditsRenderResult, GuideEntity, ManuscriptChapter, ManuscriptNote, TeleprompterFlag, TeleprompterScript } from '../../types';

const NO_ENTITIES: GuideEntity[] = [];
const NO_NOTES: ManuscriptNote[] = [];
const NO_MARKS = new Map<string, ReaderMark[]>();
const NO_DISMISSED: ReadonlySet<number> = new Set();

/** Flags the narrator dismissed, by id, for one session: flag ids restart at 1 with each script, so a new session starts clear. */
type Dismissal = { script: TeleprompterScript | null; ids: ReadonlySet<number> };

/**
 * What the dialog reads: a manuscript chapter, or the opening/closing credits
 * (manuscript-credits-card-parity.prd.md, Phase 2 - the read-aloud dialog reads the credits too, superseding the clause
 * of ADR 0150 that kept them out of it). `preview` is the same `CreditsRenderResult` the credits card already has, so
 * the dialog renders nothing it has to fetch again.
 */
export type ReadAloudSource =
  { kind: 'chapter'; chapter: Pick<ManuscriptChapter, 'id' | 'title' | 'subtitle'> } | { kind: 'credits'; credits: CreditsKind; preview: CreditsRenderResult };

type Props = {
  source: ReadAloudSource;
  /** The Story Bible entries the Manuscript page has loaded; the ones this chapter mentions are marked in the text. Chapter mode only. */
  entities?: GuideEntity[];
  /** This chapter's notes (the Manuscript page filters them to the chapter, as it does for its own reader). Chapter mode only. */
  notes?: ManuscriptNote[];
  onClose: () => void;
  /** The credits' C6 warning's "Fill them in Settings" (Phase 2, MC2): only ever shown, and only ever called, in credits mode. */
  onFixCredits?: () => void;
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
 * `source` (manuscript-credits-card-parity.prd.md Phase 2) also opens on the opening or closing credits: the same
 * session core through `useTeleprompterSession`'s existing `credits` option, no resume prompt (MC9 - there is no
 * chapter to look up a track for), the C6 unresolved-token warning in its place, and flags shown but never kept
 * (MC8 a - a credits reading has no chapter id to keep a finding against).
 *
 * Closing while a session is active stops it first (the PRD's Open Questions, "Closing the modal during a live
 * session", recommendation (a)): an orphaned live microphone capture is a privacy and CPU surprise, so a confirm asks
 * first rather than silently stopping or silently leaving it running. "Fill them in Settings" (credits mode) takes the
 * same confirm before leaving.
 */
export function ReadAloudDialog({ source, entities = NO_ENTITIES, notes = NO_NOTES, onClose, onFixCredits }: Props) {
  const isCredits = source.kind === 'credits';
  const chapter = source.kind === 'chapter' ? source.chapter : undefined;
  const session = useTeleprompterSession({
    chapterId: chapter?.id ?? '',
    chapter,
    credits: source.kind === 'credits' ? { kind: source.credits, text: source.preview.text } : undefined,
    migrateLegacyDevice: false,
  });
  // Scrolling by hand pauses following until the current word is back in the band or Follow is pressed (engines PRD
  // Phase 10); computed here, not inside `ReadAlongView`, so `ReadingControlBar`'s Follow button (in the dialog's
  // non-scrolling footer, read-aloud-control-bar.prd.md Phase 3) shares the same state.
  const follow = useFollowCursor({ active: session.active, cursor: session.cursor });
  // What Stop-and-continue does once the live session has actually stopped: just close, or close and then leave for
  // Settings (credits' "Fill them in Settings" takes the same "Stop reading?" confirm as the header Close button).
  const [confirmStop, setConfirmStop] = useState<'close' | 'settings' | null>(null);
  const [rail, setRail] = useState<RailState>(loadRailState);
  const [selected, setSelected] = useState<ReaderMarkTarget>();
  // The resume prompt's chosen quote (read-aloud-control-bar.prd.md Phase 3's start-point chip), alongside the session's
  // own `startWord`; cleared together with it (see the active/inactive effect below). Chapter mode only: credits never sets it.
  const [startLabel, setStartLabel] = useState<string>();

  const { paragraphs, rows } = session;
  const { script, flags } = session.session;
  const [visibility, setVisibility] = useState<FlagVisibility>(loadFlagVisibility);
  const [dismissal, setDismissal] = useState<Dismissal>({ script: null, ids: NO_DISMISSED });
  const dismissed = dismissal.script === script ? dismissal.ids : NO_DISMISSED;
  // `paragraphs` only ever loads for a chapter id (credits has none), so these are naturally empty in credits mode -
  // no separate check needed for "passes no story or note marks" there.
  const storyMarks = useMemo(() => (paragraphs ? readerMarks(paragraphs, entities, notes) : NO_MARKS), [paragraphs, entities, notes]);
  const shownFlags = useMemo(() => visibleFlags(flags, visibility, dismissed), [flags, visibility, dismissed]);
  const marks = useMemo(() => withMarks(storyMarks, flagMarks(rows, shownFlags)), [storyMarks, rows, shownFlags]);
  const chapterEntities = useMemo(() => markedEntities(storyMarks), [storyMarks]);
  const keepFlags = useKeptFlags(isCredits ? null : chapter!.id, rows, flags, dismissed, (ids) =>
    setDismissal({ script, ids: new Set([...dismissed, ...ids]) }),
  );
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
      setStartLabel(undefined);
    }
    wasActive.current = session.active;
  }, [session.active, keep, setStartWord]);

  // A dismissal during a session is kept with the rest when the session ends; after it has ended, it is kept at once, so the
  // finding is dismissed in the store rather than deleted (ADR 0117). Credits: keepFlags.keep is a no-op (MC8 a).
  const dismiss = (flag: TeleprompterFlag) => {
    const ids = new Set([...dismissed, flag.id]);
    setDismissal({ script, ids });
    if (!session.active) keepFlags.keep(ids);
  };

  // Closes, keeping any flags first (a no-op for credits), then leaves for Settings if that is why we closed.
  const finish = (thenFixCredits: boolean) => {
    keepFlags.keep();
    onClose();
    if (thenFixCredits) onFixCredits?.();
  };
  const requestClose = () => {
    if (session.active) {
      setConfirmStop('close');
      return;
    }
    finish(false);
  };
  const requestFixCredits = () => {
    if (session.active) {
      setConfirmStop('settings');
      return;
    }
    finish(true);
  };
  const stopAndProceed = () => {
    session.stop();
    const thenFixCredits = confirmStop === 'settings';
    setConfirmStop(null);
    finish(thenFixCredits);
  };

  // "Read aloud: " is a context prefix (chapter-title-display-consistency.prd.md Q4), so the em dash inside
  // chapterName's own full name (a subtitle, when there is one) is the only em dash in the title - never two meanings
  // for the same character. Credits have no subtitle, so this is just "Read aloud: Opening credits" for them.
  const title = chapterName(source.kind === 'chapter' ? source.chapter : { title: CREDITS_LABEL[source.credits] }, context('Read aloud'));

  return (
    // Booth scope (Phase 4, input-commands-and-pedals.prd.md): active while this dialog is open, so `reading.toggle`
    // (Space, `ReadingControlBar`) resolves here ahead of `page` and `global`, matching ADR 0196 unchanged.
    <CommandScope kind="booth">
      <Dialog
        title={title}
        size="full"
        onClose={requestClose}
        actions={null}
        footer={
          <ReadingControlBar
            session={session}
            follow={follow}
            startPoint={session.startWord !== null ? { label: startLabel ?? 'a chosen word', onClear: () => setStartWord(null) } : undefined}
            chapterId={source.kind === 'chapter' ? source.chapter.id : undefined}
          />
        }
      >
        <ReadAlongView
          session={session}
          follow={follow}
          // The resume prompt (read-aloud-resume-from-daw.prd.md Phase 1) sits in the text column's header slot, on the
          // text's own axis (read-aloud-control-bar.prd.md Phase 1): mounted for the dialog's whole life, not remounted
          // between sessions, so it settles once (on a choice or a session starting) and stays gone. Credits (MC9) has no
          // chapter to look up a track for, so the C6 warning takes this slot instead - and only while a token is unresolved.
          header={
            source.kind === 'chapter' ? (
              <ResumePrompt
                chapterId={source.chapter.id}
                model={session.model}
                active={session.active}
                onStartWord={(word, label) => {
                  session.setStartWord(word);
                  setStartLabel(label);
                }}
              />
            ) : source.preview.unresolved.length > 0 ? (
              <UnresolvedCreditsWarning kind={source.credits} tokens={source.preview.unresolved} onFix={onFixCredits && requestFixCredits} />
            ) : undefined
          }
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
      {confirmStop && (
        <ConfirmDialog
          title="Stop reading?"
          body="Reading is still listening. Closing stops it; nothing recorded in REAPER is affected."
          confirmLabel="Stop and close"
          confirm={stopAndProceed}
          cancel={() => setConfirmStop(null)}
        />
      )}
    </CommandScope>
  );
}

/**
 * Keeps the session's flags as suspected, unreviewed findings (`TeleprompterSaveFlags`, ADR 0117): when a session ends
 * (Stop, the sidecar stopping on its own, or auto-stop at Done), when the dialog closes, and when a flag is dismissed after the
 * session ended. Saving is idempotent on the host (a repeat is one finding, a dismissal is recorded once), so saving again is
 * safe. A flag an earlier session already dismissed with the same heard text comes back dismissed and is hidden here too.
 *
 * `chapterId: null` is the credits mode of the dialog (manuscript-credits-card-parity.prd.md, Phase 2, MC8 a): there is no
 * chapter id to keep a finding against, so `keep` never calls the host and the state starts (and stays) `not-kept`.
 */
function useKeptFlags(
  chapterId: string | null,
  rows: ReaderRow[],
  flags: TeleprompterFlag[],
  dismissed: ReadonlySet<number>,
  onAlreadyDismissed: (ids: number[]) => void,
) {
  const api = useApi();
  const [state, setState] = useState<FlagSaveState>(chapterId === null ? { status: 'not-kept' } : { status: 'idle' });
  const latest = useRef({ rows, flags, dismissed, onAlreadyDismissed });
  useEffect(() => {
    latest.current = { rows, flags, dismissed, onAlreadyDismissed };
  });

  const keep = useCallback(
    (dismissedNow?: ReadonlySet<number>) => {
      if (chapterId === null) return;
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
