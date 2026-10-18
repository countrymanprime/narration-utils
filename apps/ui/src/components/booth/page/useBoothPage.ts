import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DawResult } from '../../../api/contracts/daw';
import { usePedalSpace } from '../../../input/usePedalSpace';
import { useCommand } from '../../../input/useCommand';
import type { OverlayService } from '../../../overlay/overlayService';
import type { DawClient } from '../../../ports/daw';
import { usePort } from '../../../ports/usePort';
import { useContextProvider } from '../../../registries/context';
import type { ContextMenuItem } from '../../primitives/ContextMenu';
import type { LeaveGuardStore } from '../../../studio/journal/leaveGuard';
import { recordsInApp } from '../../../studio/dawNames';
import { dawShortName } from '../../../studio/StudioProvider';
import type { TeleprompterLocateResult } from '../../../types';
import { useBoothLeaveGuard } from '../leave/useBoothLeaveGuard';
import { useFullscreenKey } from '../useFullscreenKey';
import { placeOf } from '../passagemap/placeOf';
import { usePassageMapWriter } from '../passagemap/usePassageMapWriter';
import { boothUnits, type ReadingParagraph } from '../reading/boothUnits';
import { TEXT_SIZE } from '../reading/BoothText';
import { backPhrase, nextPhrase, positionOf, stepWord, unitAtPosition, type ReadingPosition, type UnitPosition } from '../reading/readingPosition';
import type { BrowseView } from '../reading/useBrowseView';
import { useRecordControl } from '../record/useRecordControl';
import { resumeOfferFor, type KeptResume, type ResumeTarget } from '../resume/resumeOfferModel';
import { useRoll } from '../roll/useRoll';
import type { TeleprompterSession } from '../useTeleprompterSession';
import { estimatedSpans, positionAtOffset, positionInScript, scriptWordAt, secondsBefore, suspectedFrom } from './readingSource';
import type { BoothStart } from './boothQuery';
import { useTakeClock } from './useTakeClock';
import { useTextChoices } from './useTextChoices';

const START: UnitPosition = { cur: 0, wcur: 0 };
const TAKE_SAVED = 'Take saved';
/** Something open over the Booth that Escape closes first: a dialog, a menu or a popover. */
const OPEN_OVER = '[role="dialog"],[role="alertdialog"],[role="menu"]';
/** How long after the shell's question closed a page still mounted means the narrator stayed. */
const STAYED_MS = 500;
const STOP_READING = {
  title: 'Stop reading?',
  body: 'Reading is still listening. Leaving the Booth stops it; nothing recorded is affected.',
  confirmLabel: 'Stop and leave',
};
/** How long a menu has to appear after it is asked for before its hold is let go. */
const MENU_GRACE_MS = 1000;

/** A punch in the take: the paragraph rolled from and the seconds into the take. */
type Punch = { paragraph: number; seconds: number };

export type BoothPageOptions = {
  /** The id the take, the passage map and the resume offer use: the chapter's, or `credits-<kind>`. */
  recordId: string;
  title: string;
  credits: boolean;
  paragraphs: readonly ReadingParagraph[];
  session: TeleprompterSession;
  daw: DawClient;
  guard: Pick<LeaveGuardStore, 'setLeaveGuard'>;
  overlay: Pick<OverlayService, 'confirm' | 'toast' | 'getSnapshot' | 'subscribe'>;
  /** Where Record from here opened the Booth. */
  from?: BoothStart;
  /** Goes to `next`; called only once the leave guard let the narrator go. */
  navigate: (next: string) => void;
  /** Where Exit Booth goes. */
  exitTo: string;
  /**
   * A take stopped: the sentences it began and stopped on. `quiet` when it stopped because the narrator left. Answers how many
   * pickups it marked recorded and suspected lines it added to Pickups, when it says so itself (its toast then says the take is saved).
   */
  onTakeStopped?: (take: { began: number; stopped: number; quiet?: boolean }) => void | Promise<number>;
  /**
   * More right-click items for this target, put after Start from here (the bookmark items). When the target is a bookmark ribbon
   * (`[data-bm]`), they are the whole menu.
   */
  menuItems?: (target: Element) => ContextMenuItem[];
};

/**
 * The Booth page's behaviour over its parts: the reading position (from the voice while listening, else the keys and clicks), one take
 * (the Record control starts and stops it; the listening session, the timer and the passage map's run follow it), the roll, the resume
 * line, the keys (`useCommand`, none listened for here), the right-click menu, and every way out through `useBoothLeaveGuard`.
 */
export function useBoothPage(options: BoothPageOptions) {
  const { recordId, title, credits, paragraphs, session, daw, guard, overlay, from, navigate, exitTo } = options;
  const extras = useRef({ onTakeStopped: options.onTakeStopped, menuItems: options.menuItems });
  extras.current = { onTakeStopped: options.onTakeStopped, menuItems: options.menuItems };
  const notify = useCallback((sentence: string, topic?: string) => overlay.toast(sentence, topic ? { topic } : undefined), [overlay]);
  const units = useMemo(() => boothUnits(paragraphs), [paragraphs]);
  const script = session.session.script;
  const listening = session.active && !!script;
  const spans = useMemo(() => (script ? script.spans : estimatedSpans(title, paragraphs)), [script, title, paragraphs]);

  // Where the narrator is: the voice while a session listens, the keys and clicks otherwise.
  const [local, setLocal] = useState<UnitPosition>(START);
  const heard = listening ? positionInScript(spans, paragraphs, session.cursor) : null;
  const at: UnitPosition = (heard && unitAtPosition(paragraphs, units, heard)) ?? clampAt(local, units.length);
  const position: ReadingPosition | undefined = positionOf(paragraphs, units, at) ?? undefined;
  const [browse, setBrowse] = useState(false);
  const [punchAt, setPunchAt] = useState<number | null>(null);
  const text = useTextChoices();
  const { setSize } = text;
  const view = useRef<BrowseView>(null);

  const control = useRecordControl({ chapterId: recordId, notify });
  const { recording, toggle: recordToggle } = control;
  // The take's length is the wall clock's (`useTakeClock`): a question that holds the reading never holds the clock, the DAW records on.
  const takeClock = useTakeClock(recording);
  const { seconds } = takeClock;
  const [paused, setPaused] = useState(false);
  const [recorded, setRecorded] = useState(0);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [kept, setKept] = useState<KeptResume | null>(null);
  const takeAt = useRef(0);
  // The sentence the running take began on; null once its stop has been told (`onTakeStopped`), so a take is told once.
  const takeBegan = useRef<number | null>(null);
  const tellStopped = useCallback(async (quiet: boolean): Promise<number> => {
    const began = takeBegan.current;
    if (began === null) return 0;
    takeBegan.current = null;
    return (await extras.current.onTakeStopped?.({ began, stopped: latest.current.at.cur, quiet })) ?? 0;
  }, []);
  // The take is stopping because the reading reached the end of the chapter: its stop says the take is saved.
  const endOfChapter = useRef(false);

  const latest = useRef({ at, position, units, paragraphs, spans, listening, session, recording, elapsed: takeClock.read });
  latest.current = { at, position, units, paragraphs, spans, listening, session, recording, elapsed: takeClock.read };

  /** Puts the reading position on a sentence and word; a listening session is moved there too. */
  const moveTo = useCallback((next: UnitPosition) => {
    const now = latest.current;
    setLocal(next);
    setBrowse(false);
    const target = positionOf(now.paragraphs, now.units, next);
    const word = target && now.listening ? scriptWordAt(now.spans, now.paragraphs, target) : null;
    if (word !== null) now.session.seek(word);
  }, []);

  // Record from here: the place the Script named is where the reading starts and the next take begins.
  const startedFrom = useRef(false);
  useEffect(() => {
    if (startedFrom.current || !from || units.length === 0) return;
    const target = positionAtOffset(paragraphs, from.paragraphId, from.offset);
    const unit = target && unitAtPosition(paragraphs, units, target);
    startedFrom.current = true;
    if (!unit) return;
    setLocal(unit);
    setPunchAt(unit.cur);
  }, [from, paragraphs, units]);

  // The next listening session starts at the reading position (docs/guides/using-the-app/booth.md#where-you-stopped: a choice only sets where Start begins).
  const startWord = position && !listening ? scriptWordAt(spans, paragraphs, position) : null;
  const { setStartWord } = session;
  useEffect(() => {
    if (!session.active) setStartWord(startWord);
  }, [startWord, session.active, setStartWord]);

  // The resume line: one lookup per chapter while no take runs; it also says where the recording ends, for the punch rule.
  const teleprompter = usePort('teleprompter');
  const model = useRef(session.model);
  model.current = session.model;
  const [located, setLocated] = useState<{ id: string; result: TeleprompterLocateResult } | null>(null);
  useEffect(() => {
    if (recording || credits) return;
    let live = true;
    void teleprompter
      .teleprompterLocate(recordId, { model: model.current })
      .then((result) => live && setLocated({ id: recordId, result }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [teleprompter, recordId, recording, credits]);
  const result = located?.id === recordId ? located.result : null;
  const recordedEnd = result && 'recordedEnd' in result ? (result.recordedEnd?.projectTime ?? 0) : 0;
  const resume = resumeOfferFor({ spans, recording, kept, result });
  const chooseResume = useCallback(
    (target: ResumeTarget) => {
      const unit = unitAtPosition(latest.current.paragraphs, latest.current.units, { paragraphId: target.paragraphId, word: target.word });
      if (unit) moveTo(unit);
    },
    [moveTo],
  );

  // The passage map's run follows the take.
  const writer = usePassageMapWriter({
    chapterId: recordId,
    current: () => ({
      at: placeOf(latest.current.paragraphs, latest.current.units, latest.current.at) ?? { pid: '', word: 0 },
      elapsed: latest.current.elapsed(),
    }),
    notify,
  });

  const pause = useCallback(() => {
    setPaused(true);
    if (latest.current.listening) latest.current.session.pause(true);
  }, []);
  const resumeTake = useCallback(() => {
    setPaused(false);
    if (latest.current.listening) latest.current.session.pause(false);
  }, []);

  const roll = useRoll(
    {
      capabilities: control.capabilities,
      recording,
      phraseCount: units.length,
      phrase: at.cur,
      punchAt,
      paragraphOf: (phrase) => units[phrase]?.paragraphIndex ?? 0,
      secondsOf: (phrase) => secondsBefore(units, phrase),
      recordedEnd,
      takeSeconds: seconds,
      recordRefusal: control.disabled ? control.reason : '',
    },
    {
      roll: (_phrase, { confirmed }) => daw.roll(recordId, takeAt.current + latest.current.elapsed(), { confirmed }),
      pause,
      resume: resumeTake,
      beginTake: async (punch) => {
        // The live speech model is checked before anything records: a missing one opens its install question here, and no take begins
        // behind it (the DAW would otherwise record while the narrator is still being asked, and while it downloads).
        if (!(await latest.current.session.ensureModel())) return;
        takeAt.current = punch ?? recordedEnd;
        return control.toggle();
      },
      clearStart: () => setPunchAt(null),
      chooseStart: (phrase, move) => {
        setPunchAt(phrase);
        if (move) moveTo({ cur: phrase, wcur: 0 });
      },
      moveTo: (phrase) => {
        const now = latest.current;
        const to = placeOf(now.paragraphs, now.units, { cur: phrase, wcur: 0 });
        const prev = placeOf(now.paragraphs, now.units, now.at);
        if (to && prev) writer.roll(to, prev, now.elapsed());
        moveTo({ cur: phrase, wcur: 0 });
      },
      logPunch: (punch) => setPunches((list) => [...list, punch]),
      notify,
    },
    { overlay },
  );
  const { hold } = roll;

  // A take started or ended: the timer, the listening session and the passage map's run follow the Record control.
  const was = useRef(recording);
  useEffect(() => {
    if (was.current === recording) return;
    was.current = recording;
    const now = latest.current;
    const place = placeOf(now.paragraphs, now.units, now.at);
    if (recording) {
      setPaused(false);
      setBrowse(false);
      takeBegan.current = now.at.cur;
      if (place) writer.begin(place, takeAt.current);
      if (!now.session.active && now.session.canStart) void now.session.start();
      return;
    }
    if (place) void writer.stop(place, now.elapsed());
    if (now.session.active) now.session.stop();
    const said = endOfChapter.current;
    endOfChapter.current = false;
    void tellStopped(false).then((marked) => {
      // A take that marked or added pickups says it was saved in that toast.
      if (said && marked === 0) notify(TAKE_SAVED);
    });
    setRecorded((total) => total + now.elapsed());
    if (now.position) setKept({ paragraphId: now.position.paragraphId, word: now.position.word });
  }, [recording, writer, tellStopped, notify]);

  // The end of the chapter (BO-1 item 2): the listening session heard the last word ("done") and then stopped itself, and
  // the take stops with it, through the Record control's own stop. Reading on past the end clears "done", and a session that stops
  // any other way leaves the take running.
  const reachedEnd = useRef(false);
  const heardStatus = session.session.position?.status;
  useEffect(() => {
    reachedEnd.current = recording && heardStatus === 'done';
  }, [recording, heardStatus]);
  const wasListening = useRef(session.active);
  useEffect(() => {
    const ended = wasListening.current && !session.active;
    wasListening.current = session.active;
    if (!ended || !reachedEnd.current || !latest.current.recording) return;
    reachedEnd.current = false;
    endOfChapter.current = true;
    void recordToggle();
  }, [session.active, recordToggle]);

  // Leaving. The question holds the take while it is open; Yes stops the recording the app started and the listening with it.
  const markStopped = control.stopped;
  const stopRecording = useCallback(async (): Promise<DawResult> => {
    const result = await daw.recordStop();
    // The take is over now: the leave guard that asked is waiting to go, and it must not see a take still running until the DAW's next heartbeat.
    if (result.ok) markStopped();
    if (result.ok && latest.current.session.active) latest.current.session.stop();
    // Stopped on the way out: the pickups it read over are marked without a toast, as the page is going.
    if (result.ok) void tellStopped(true);
    return result;
  }, [daw, tellStopped, markStopped]);
  const askedByShell = useRef(false);
  const shellGuard = useMemo<Pick<LeaveGuardStore, 'setLeaveGuard'>>(
    () => ({
      setLeaveGuard: (next) =>
        guard.setLeaveGuard(
          next &&
            ((path) => {
              askedByShell.current = true;
              return next(path);
            }),
        ),
    }),
    [guard],
  );
  const heldConfirm = useMemo<Pick<OverlayService, 'confirm'>>(
    () => ({
      confirm: async (spec) => {
        const release = latest.current.recording ? hold() : null;
        try {
          return await overlay.confirm(spec);
        } finally {
          release?.();
        }
      },
    }),
    [overlay, hold],
  );
  // The question names what records from the capability report; the shell's short name for no DAW ("Built-in") names the app's recorder.
  const dawName = !control.capabilities
    ? 'the DAW'
    : control.capabilities.daw === 'none' || recordsInApp(control.capabilities.daw)
      ? `the ${dawShortName('none').toLowerCase()} recorder`
      : control.capabilities.daw;
  const { leave } = useBoothLeaveGuard(
    { recording, startedByApp: control.startedByApp, daw: { name: dawName }, stopRecording, flush: writer.flush },
    { guard: shellGuard, overlay: heldConfirm },
  );

  // A move the shell asked about and the narrator let go of unmounts the page mid-take: the take stops then, and only then. A page
  // still here a moment after the shell's question closed means the narrator stayed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = overlay.subscribe(() => {
      if (!askedByShell.current || overlay.getSnapshot().dialogs.length > 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        askedByShell.current = false;
      }, STAYED_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [overlay]);
  const onGone = useRef({ stopRecording, flush: writer.flush });
  onGone.current = { stopRecording, flush: writer.flush };
  useEffect(
    () => () => {
      if (!latest.current.recording || !askedByShell.current) return;
      void onGone.current.stopRecording().then((done) => (done.ok ? onGone.current.flush() : undefined));
    },
    [],
  );

  // Exit Booth. A take asks "Stop recording?" (the leave guard); a session that only listens asks "Stop reading?" and stops it (docs/guides/using-the-app/booth.md:
  // leaving by the nav keeps it running, Exit and Escape stop it).
  const exit = useCallback(() => {
    if (latest.current.recording || !latest.current.session.active) {
      void leave(exitTo, navigate);
      return;
    }
    void overlay.confirm(STOP_READING).then((yes) => {
      if (!yes) return;
      latest.current.session.stop();
      navigate(exitTo);
    });
  }, [leave, exitTo, navigate, overlay]);
  const goTo = useCallback((next: string) => leave(next, navigate), [leave, navigate]);

  // F11: the window's fullscreen; a window the Booth made fullscreen goes back when the Booth is left.
  useFullscreenKey();

  // The keys: every one is a catalogue command; the router keeps a field's own keys and any modified press away from them.
  const toggleTake = useCallback(() => (latest.current.recording ? control.toggle() : roll.startTake()), [control, roll]);
  useCommand('reading.toggle', () => void toggleTake());
  usePedalSpace(toggleTake);
  useCommand('booth.phrase.next', () => moveTo(nextPhrase(latest.current.units, latest.current.at)));
  useCommand('booth.phrase.prev', () => moveTo(backPhrase(latest.current.at)));
  useCommand('booth.word.next', () => moveTo(stepWord(latest.current.units, latest.current.at, 1)));
  useCommand('booth.word.prev', () => moveTo(stepWord(latest.current.units, latest.current.at, -1)));
  useCommand('booth.roll', () => void roll.punchAndRoll());
  useCommand('booth.view.down', () => view.current?.down(0.8));
  useCommand('booth.view.up', () => view.current?.up(0.8));
  useCommand('booth.text.larger', () => setSize((s) => Math.min(TEXT_SIZE.max, s + TEXT_SIZE.step)));
  useCommand('booth.text.smaller', () => setSize((s) => Math.max(TEXT_SIZE.min, s - TEXT_SIZE.step)));
  useCommand('booth.exit', () => {
    // A dialog, menu or popover closes on its own Escape first; the side panel's drawer takes Escape before it reaches here.
    if (document.querySelector(OPEN_OVER)) return;
    exit();
  });

  // Right-click: a running take is held while the menu is open, and every way it closes lets go of it.
  const root = useRef<HTMLDivElement>(null);
  const menu = useMemo(
    () => ({
      match: (target: Element) => !!root.current?.contains(target),
      items: (target: Element) => {
        const release = latest.current.recording ? holdWhileMenuOpen(hold) : () => {};
        const run = (action: () => void) => () => {
          release();
          action();
        };
        const unit = target.closest<HTMLElement>('[data-unit]');
        const phrase = unit ? Number(unit.dataset.unit) : null;
        const larger = () => setSize((s) => Math.min(TEXT_SIZE.max, s + TEXT_SIZE.step));
        const smaller = () => setSize((s) => Math.max(TEXT_SIZE.min, s - TEXT_SIZE.step));
        const more = (extras.current.menuItems?.(target) ?? []).map((item) => ({ ...item, onSelect: run(item.onSelect) }));
        if (target.closest('[data-bm]')) return more;
        return [
          ...(phrase === null ? [] : [{ key: 'start', label: 'Start from here', onSelect: run(() => void roll.startFromHere(phrase)) }]),
          ...more,
          { key: 'next', label: 'Next phrase', onSelect: run(() => moveTo(nextPhrase(latest.current.units, latest.current.at))) },
          { key: 'back', label: 'Back one phrase', onSelect: run(() => moveTo(backPhrase(latest.current.at))) },
          { key: 'roll', label: 'Punch and roll', onSelect: run(() => void roll.punchAndRoll()) },
          { key: 'larger', label: 'Larger text', onSelect: run(larger) },
          { key: 'smaller', label: 'Smaller text', onSelect: run(smaller) },
          { key: 'exit', label: 'Exit Booth', onSelect: run(exit) },
        ];
      },
    }),
    [hold, roll, moveTo, exit, setSize],
  );
  useContextProvider(menu);

  const flags = useMemo(
    () => (script ? suspectedFrom(session.session.flags, spans, paragraphs, recordId) : []),
    [script, session.session.flags, spans, paragraphs, recordId],
  );
  const lastPunch = punches.at(-1);

  return {
    root,
    view,
    units,
    at,
    position,
    browse,
    setBrowse,
    punchAt,
    text,
    control,
    paused,
    seconds,
    resume,
    chooseResume,
    flags,
    dawName,
    numbers: {
      recordedSeconds: recorded + (recording ? seconds : 0),
      punches: punches.length,
      lastPunch: lastPunch ? `Rolled from ¶ ${lastPunch.paragraph + 1} · ${clock(lastPunch.seconds)}` : undefined,
      nextRoll: punchAt !== null && units[punchAt] ? `Next roll starts from ¶ ${units[punchAt].paragraphIndex + 1}` : undefined,
    },
    seek: (paragraphId: string, word: number) => {
      const unit = unitAtPosition(paragraphs, units, { paragraphId, word });
      if (unit) moveTo(unit);
    },
    exit,
    goTo,
    leave,
    toggleTake,
  };
}

const clampAt = (at: UnitPosition, count: number): UnitPosition =>
  count === 0 ? START : { cur: Math.max(0, Math.min(at.cur, count - 1)), wcur: Math.max(0, at.wcur) };

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * Holds the take while the context menu that is opening stays open: the menu is the document's `role="menu"` once it renders, and
 * the hold is let go when it leaves the document (an item, Escape, a click outside), or when none appears. Returns the release.
 */
function holdWhileMenuOpen(hold: () => () => void): () => void {
  const release = hold();
  let seen = false;
  const check = () => {
    const open = !!document.querySelector('[role="menu"]');
    if (open) seen = true;
    else if (seen) done();
  };
  const observer = new MutationObserver(check);
  const grace = setTimeout(() => {
    if (!seen) done();
  }, MENU_GRACE_MS);
  function done() {
    observer.disconnect();
    clearTimeout(grace);
    release();
  }
  observer.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(check);
  return done;
}
