import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { chapterName } from '../../chapterName';
import { useApi } from '../../api/ApiContext';
import { useCapability } from '../../useCapability';
import { CommandScope } from '../../input/router';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { BoothView } from './BoothView';
import { CompanionShell } from './CompanionShell';
import { RecordInReaperConfirm } from './RecordInReaperConfirm';
import { useRecordInReaper } from './useRecordInReaper';
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
 * What the Booth reads: a manuscript chapter, or the opening/closing credits (manuscript-credits-card-parity.prd.md
 * Phase 2, superseding the clause of ADR 0150 that kept them out of the read-aloud dialog). `preview` is the credits'
 * `CreditsRenderResult`, so the Booth renders nothing it has to fetch again.
 */
export type BoothSource =
  { kind: 'chapter'; chapter: Pick<ManuscriptChapter, 'id' | 'title' | 'subtitle'> } | { kind: 'credits'; credits: CreditsKind; preview: CreditsRenderResult };

type Props = {
  source: BoothSource;
  /** The Story Bible entries; the ones this chapter mentions are marked in the text. Chapter mode only. */
  entities?: GuideEntity[];
  /** This chapter's notes. Chapter mode only. */
  notes?: ManuscriptNote[];
  /** The pre-session setup `BoothPage` builds (the chapter picker), shown above the text while no session runs. */
  setup?: ReactNode;
  /** Leaves the Booth (Exit booth, or Escape), once a live session has been stopped with the narrator's consent. */
  onExit: () => void;
  /** The credits' C6 warning's "Fill them in Settings": only ever shown, and only ever called, in credits mode. */
  onFixCredits?: () => void;
};

/** Whether a dialog, alert dialog or popover is open: Escape is theirs to close first, never the Booth's exit. */
const overlayOpen = () => Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));

/** The entities the marks point at, once each, in the order they first appear in the chapter. */
function markedEntities(marks: Map<string, ReaderMark[]>): GuideEntity[] {
  const seen = new Map<string, GuideEntity>();
  for (const rowMarks of marks.values())
    for (const mark of rowMarks) if (mark.value.kind === 'entity' && !seen.has(mark.value.entity.id)) seen.set(mark.value.entity.id, mark.value.entity);
  return [...seen.values()];
}

const byReadingOrder = (a: ManuscriptNote, b: ManuscriptNote): number => a.paragraph - b.paragraph || (a.anchorStart ?? 0) - (b.anchorStart ?? 0);

/**
 * One reading session in the Booth (stage-navigation-and-page-replacement.prd.md Phase 4, replacing the Read aloud
 * dialog, its booth layout and the Teleprompter page): the one `useTeleprompterSession` mount (booth mode's risk: never
 * two subscriptions), the rail and its marks, the suspected flags and keeping them as findings (`useKeptFlags`, ADR
 * 0117), the resume prompt (read-aloud-resume-from-daw.prd.md) and Record in REAPER (read-aloud-control-bar.prd.md Phase
 * 7). `BoothPage` mounts it keyed by what it reads, so a new chapter starts a clean session state.
 *
 * It is laid out by `BoothView` (mock 03) or, in companion mode (entered from the Booth's header, ADR 0401), by
 * `CompanionShell`, whose "Full app" (or a double Escape) comes back here with the same session still running.
 *
 * Leaving while a session is active stops it first, after a confirm (the read-aloud dialog's rule, kept: an orphaned live
 * microphone capture is a privacy and CPU surprise). Escape is Exit booth, the same confirm while listening. The flags are
 * kept when a session ends, when the Booth is left and when a flag is dismissed after the session.
 */
export function BoothSession({ source, entities = NO_ENTITIES, notes = NO_NOTES, setup, onExit, onFixCredits }: Props) {
  const [mode, setMode] = useState<'booth' | 'companion'>('booth');
  const isCredits = source.kind === 'credits';
  const chapter = source.kind === 'chapter' ? source.chapter : undefined;
  const session = useTeleprompterSession({
    chapterId: chapter?.id ?? '',
    chapter,
    credits: source.kind === 'credits' ? { kind: source.credits, text: source.preview.text } : undefined,
  });
  // Scrolling by hand pauses following until the current word is back in the band or Follow is pressed (engines PRD
  // Phase 10); shared by the text and the command bar's Follow button.
  const follow = useFollowCursor({ active: session.active, cursor: session.cursor });
  // One capability subscription and one Play/Stop orchestrator for the command bar's toggle and this Booth's own "Stop
  // reading?" confirm (read-aloud-control-bar.prd.md Phase 7, booth-actions-enablement.prd.md Phase 2). Credits have no
  // chapter track: every method that would touch REAPER checks for a chapter id first and no-ops without one.
  const record = useCapability('record');
  const recording = useRecordInReaper(chapter?.id, record.available);
  const chapterTitle = source.kind === 'chapter' ? chapterName(source.chapter, 'full') : CREDITS_LABEL[source.credits];
  // What Stop-and-continue does once the live session has stopped: leave the Booth, or leave for Settings (credits'
  // "Fill them in Settings" takes the same "Stop reading?" confirm as Exit booth).
  const [confirmStop, setConfirmStop] = useState<'exit' | 'settings' | null>(null);
  const [rail, setRail] = useState<RailState>(loadRailState);
  const [selected, setSelected] = useState<ReaderMarkTarget>();
  // The resume prompt's chosen quote (read-aloud-control-bar.prd.md Phase 3's start-point chip), alongside the session's
  // own `startWord`; cleared together with it (see the active/inactive effect below). Chapter mode only.
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

  // A session that ends while the Booth is open (Stop, the sidecar stopping, auto-stop at Done) keeps its flags then: by the
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

  // Leaves for Settings if that is why, else wherever Exit booth goes; the flags are kept as the Booth unmounts (below).
  const finish = (thenFixCredits: boolean) => {
    if (thenFixCredits) onFixCredits?.();
    else onExit();
  };
  const requestExit = () => {
    if (session.active) {
      setConfirmStop('exit');
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
    recording.afterStop();
    const thenFixCredits = confirmStop === 'settings';
    setConfirmStop(null);
    finish(thenFixCredits);
  };

  // Leaving the Booth, whichever way (Exit booth, the nav, Back, a new chapter), keeps what this session flagged, as
  // closing the read-aloud dialog did (a no-op for credits).
  const keepOnLeave = useRef(keep);
  useEffect(() => {
    keepOnLeave.current = keep;
  });
  useEffect(() => () => keepOnLeave.current(), []);

  // Escape is Exit booth (mock 03), unless something on top of the Booth - a confirm, a popover - is open to take it. A
  // React handler on the Booth's own root, like CompanionShell's double Escape, rather than a command: the router's target
  // guard would swallow it whenever focus is on a button (Play, just pressed), where the dialog's Escape always worked.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || overlayOpen()) return;
    event.preventDefault();
    requestExit();
  };

  // Built once and handed to whichever layout renders it: `FocusShell`'s `rail` landmark in the Booth.
  const railElement = (
    <ReaderRail
      state={rail}
      onTab={(tab) => setRail((current) => ({ ...current, tab }))}
      onToggle={() => setRail((current) => ({ ...current, open: !current.open }))}
      seekable={session.active}
      fill
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
  );
  // The resume prompt (read-aloud-resume-from-daw.prd.md Phase 1) sits in the text column's header slot, mounted for this
  // session's whole life so it settles once (on a choice or a session starting) and stays gone. Credits (MC9) have no
  // chapter to look up a track for, so the C6 warning takes this slot instead - and only while a token is unresolved.
  const header =
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
    ) : undefined;

  return (
    // Booth scope (input-commands-and-pedals.prd.md Phase 4): `reading.toggle` (Space) resolves here ahead of `global`.
    <CommandScope kind="booth">
      {mode === 'companion' ? (
        <CompanionShell
          session={session}
          follow={follow}
          chapterTitle={chapterTitle}
          recording={recording}
          marks={marks}
          header={header}
          onFullApp={() => setMode('booth')}
        />
      ) : (
        <div className="size-full" onKeyDown={onKeyDown}>
          <BoothView
            session={session}
            follow={follow}
            chapterId={chapter?.id}
            chapterTitle={chapterTitle}
            recording={recording}
            startPoint={session.startWord !== null ? { label: startLabel ?? 'a chosen word', onClear: () => setStartWord(null) } : undefined}
            marks={marks}
            onOpenMark={openMark}
            header={header}
            setup={setup}
            rail={railElement}
            speakers={isCredits ? undefined : chapterEntities}
            onOpenSpeaker={(entity) => {
              setSelected({ kind: 'entity', entity });
              setRail({ open: true, tab: 'bible' });
            }}
            onCompanion={() => setMode('companion')}
            onExit={requestExit}
          />
        </div>
      )}
      {confirmStop && (
        <ConfirmDialog
          title="Stop reading?"
          body={
            recording.recording
              ? "Reading is still listening. Leaving the booth stops it and stops REAPER's recording."
              : 'Reading is still listening. Leaving the booth stops it; nothing recorded in REAPER is affected.'
          }
          confirmLabel="Stop and leave"
          confirm={stopAndProceed}
          cancel={() => setConfirmStop(null)}
        />
      )}
      {recording.confirmPending && chapter && (
        <RecordInReaperConfirm chapterTitle={chapterTitle} confirm={recording.confirm} cancel={recording.cancelConfirm} />
      )}
    </CommandScope>
  );
}

/**
 * Keeps the session's flags as suspected, unreviewed findings (`TeleprompterSaveFlags`, ADR 0117): when a session ends
 * (Stop, the sidecar stopping on its own, or auto-stop at Done), when the Booth is left, and when a flag is dismissed after the
 * session ended. Saving is idempotent on the host (a repeat is one finding, a dismissal is recorded once), so saving again is
 * safe. A flag an earlier session already dismissed with the same heard text comes back dismissed and is hidden here too.
 *
 * `chapterId: null` is the credits mode of the Booth (manuscript-credits-card-parity.prd.md, Phase 2, MC8 a): there is no
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
