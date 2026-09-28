import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleDot, faCrosshairs, faGear, faLock, faMicrophone, faRotate, faStop, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCommand } from '../../input/useCommand';
import { useCapability } from '../../useCapability';
import { Button } from '../primitives/Button';
import { CapabilityGate, type CapabilityEntry } from '../primitives/CapabilityGate';
import { IconButton } from '../primitives/IconButton';
import { KeyHint } from '../primitives/KeyHint';
import { LevelMeter } from '../primitives/LevelMeter';
import { Popover } from '../primitives/Popover';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { Toolbar, ToolbarButton } from '../primitives/Toolbar';
import { TooltipTarget } from '../primitives/Tooltip';
import { clockText } from './boothProgress';
import { MicrophoneField } from './MicrophoneField';
import { useInputLevel } from './useInputLevel';
import { useReadAloudReaperState } from './useReadAloudReaperState';
import type { RecordInReaperState } from './useRecordInReaper';
import type { FollowCursor } from './useFollowCursor';
import { ENGINE_LABELS, MODELS, type TeleprompterSession } from './useTeleprompterSession';
import type { ReadAloudReaperState } from '../../types';
import { RecordButton } from './BuiltinRecorder';
import type { Recorder } from './useRecorder';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

/** The start point the sibling PRD's resume prompt chose, shown as a clearable chip while idle (its RD9). */
type StartPoint = { label: string; onClear: () => void };

type Props = {
  session: TeleprompterSession;
  follow: FollowCursor;
  startPoint?: StartPoint;
  /**
   * The chapter Phase 6's REAPER state indicator asks about; absent in credits mode (no chapter track, Phase 7's own
   * scope) and on the standalone page (Q11 A - it has no fixed chapter until Phase 13 retires it), where the bar shows
   * no REAPER control at all.
   */
  chapterId?: string;
  /** The chapter's plain display name (no "Read aloud:" prefix), named in the arm button and the first-time confirm. */
  chapterTitle?: string;
  /** The chapter's short name (its title without the subtitle), in the armed state: "Chapter 1 armed" (mock 06). */
  chapterShortTitle?: string;
  /** The Record-in-REAPER toggle's state and Play/Stop orchestration (Phase 7, `useRecordInReaper`), owned by
   * BoothSession since its own "Stop reading?" confirm also needs to stop a recording this app started. */
  recording?: RecordInReaperState;
  /** The built-in recorder (native-recording-suite Phase 2): with the project on it, its Record toggle replaces Record in REAPER. */
  recorder?: Recorder;
};

// A do-nothing RecordInReaperState for a caller that passes no `recording` (the Booth always passes one; this keeps the
// bar usable on its own, as in its tests), so Play and Stop orchestrate nothing rather than needing a null check at every call site.
const NO_RECORDING: RecordInReaperState = {
  loaded: true,
  enabled: false,
  recording: false,
  armPending: false,
  confirmPending: false,
  toggle: () => {},
  confirm: () => {},
  cancelConfirm: () => {},
  armOnly: async () => {},
  beforeStart: async () => true,
  afterStop: () => {},
};

// The words for the chapter's REAPER state, on the Record in REAPER toggle below; the armed one names the chapter
// (read-aloud-control-bar mock 06: "Chapter 1 armed").
const reaperStatusText = (status: ReadAloudReaperState['status'], chapter?: string): string =>
  status === 'ready' ? `${chapter || 'Chapter'} armed` : REAPER_STATUS_TEXT[status];
const REAPER_STATUS_TEXT: Record<Exclude<ReadAloudReaperState['status'], 'ready'>, string> = {
  not_armed: 'Not armed',
  other_armed: 'Other track armed',
  several_armed: 'Several armed',
  no_link: 'No linked track',
  recording_elsewhere: 'Recording',
  unavailable: 'Unavailable',
};

// Arming fixes exactly these three statuses (Q7 A); "Arm <chapter> only" offers nothing for a status arming cannot
// change (recording_elsewhere, no_link, unavailable) or is already true for (ready).
const ARMABLE_STATUSES: ReadonlySet<ReadAloudReaperState['status']> = new Set(['not_armed', 'other_armed', 'several_armed']);

/**
 * The REAPER state the bar shows and the Record-in-REAPER toggle (read-aloud-control-bar.prd.md Phase 6 and Phase 7,
 * ADR 0249; booth-actions-enablement.prd.md Phase 2): whether the chapter's linked track is the one track armed in
 * REAPER and whether it is recording, refreshed on mount and by its own Refresh button, never on a timer (ADR 0122),
 * plus the switch-like toggle itself and, while it is on and the chapter's track is not the one armed, "Arm
 * `<chapter>` only" (Q7 A) to fix that with one click. It is gated on the DAW port's `record` capability (DAW port
 * PRD Phase 7, ADR 0360) rather than hard-coded disabled: experimental and off by default (no behaviour change),
 * that reason explains it; once on, the chapter's own armed/recording state is the more useful one to show.
 */
function ReaperStateIndicator({
  chapterId,
  chapterTitle,
  chapterShortTitle,
  recording,
}: {
  chapterId: string;
  chapterTitle?: string;
  chapterShortTitle?: string;
  recording: RecordInReaperState;
}) {
  const { state, error, refresh } = useReadAloudReaperState(chapterId);
  const record = useCapability('record');
  const elapsed = useElapsedSeconds(recording.recordingSince);
  const statusText = state ? reaperStatusText(state.status, chapterShortTitle) : undefined;
  // While this app's recording runs, the toggle says so with its length (mock 07: "REC 06:42").
  const rec = elapsed === undefined ? undefined : `REC ${clockText(elapsed, 2)}`;
  const label = rec ? `Record in REAPER: recording, ${clockText(elapsed!, 2)}` : statusText ? `Record in REAPER: ${statusText}` : 'Record in REAPER';
  const capability: CapabilityEntry = record.available ? { ...record, message: state?.message ?? error ?? 'Checking REAPER…' } : record;
  const armLabel = chapterTitle ? `Arm "${chapterTitle}" only` : 'Arm this chapter only';
  return (
    // A group of up to three toolbar items, not one control, so each is its own `ToolbarButton` rather than the group as a
    // whole: `CapabilityGate` gates the main toggle by cloning props onto it (Q7's disabled/aria-describedby wiring), which
    // only reaches the real `Button` when `ToolbarButton` wraps that `CapabilityGate` from the outside (its own `render`
    // merge lands on `CapabilityGate` itself, which ignores it harmlessly) rather than being nested inside it.
    <div className="flex items-center gap-1">
      <ToolbarButton
        render={
          <CapabilityGate capability={capability}>
            <Button
              aria-label={label}
              aria-pressed={recording.enabled}
              variant="secondary"
              className="max-w-[9rem] lg:max-w-[13rem]"
              onClick={recording.toggle}
            >
              <FontAwesomeIcon icon={faCircleDot} className={rec || state?.recording ? 'text-[var(--danger-text)]' : undefined} />
              {rec ? (
                <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap text-[var(--danger-text)] normal-case">{rec}</span>
              ) : (
                <span className="hidden truncate lg:inline">{statusText ?? 'Record in REAPER'}</span>
              )}
            </Button>
          </CapabilityGate>
        }
      />
      {recording.enabled && state && ARMABLE_STATUSES.has(state.status) && (
        <ToolbarButton
          render={
            <Button aria-label={armLabel} variant="secondary" onClick={() => void recording.armOnly().then(refresh)} disabled={recording.armPending}>
              <FontAwesomeIcon icon={faLock} />
              <span className="hidden lg:inline">Arm only</span>
            </Button>
          }
        />
      )}
      <ToolbarButton
        render={
          <IconButton label="Refresh REAPER state" onClick={refresh}>
            <FontAwesomeIcon icon={faRotate} className="text-[0.7rem]" />
          </IconButton>
        }
      />
    </div>
  );
}

/** Whole seconds since `since` (a `Date.now()`), ticking once a second; undefined while `since` is. */
function useElapsedSeconds(since: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === undefined ? undefined : Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * The read-aloud media bar (read-aloud-control-bar.prd.md Phases 3-7), replacing the configuration `Panel`: a Play/Pause
 * toggle and Stop, status and word count, the start-point chip, Follow, a microphone popover (device list, Refresh and a
 * live level meter, Phase 4), the chapter's REAPER state and Record-in-REAPER toggle (Phase 6-7) and a Settings popover
 * (Engine and Model). Rendered outside the dialog's scrolling body (`Dialog`'s `footer` slot) or, on the standalone page,
 * sticky at the bottom of its own column (Q11), so it is never scrolled out of view.
 *
 * Play and Stop orchestrate `recording` (Phase 7, Q8): with the toggle on, Play asks REAPER to start recording first and
 * only starts listening once it confirms; a refusal or timeout shows why instead (`recording.error`, in the status line)
 * and nothing starts. Stop always stops listening, then stops a recording this app started.
 *
 * The bar composes the `Toolbar`/`ToolbarButton` primitives for its roving-tabindex toolbar semantics
 * (mock-fidelity-primitives-and-components.prd.md Phase 13, mock 03's command bar) rather than a hand-rolled
 * `role="toolbar"`, and gives Play/Pause's real Space shortcut a `KeyHint` (23 px cap) so it reads the way the mock's
 * key-cap-plus-label pairs do; BO10's other labelled actions (Punch & roll, Back one sentence, Flag, Mark pickup) stay out
 * because they have no bound command yet (booth-actions-enablement/input-commands own that).
 */
export function ReadingControlBar({ session: t, follow, startPoint, chapterId, chapterTitle, chapterShortTitle, recording = NO_RECORDING, recorder }: Props) {
  const [micOpen, setMicOpen] = useState(false);
  const { level, error: levelError } = useInputLevel(t.device, { active: t.active, enabled: micOpen });
  // While a session runs, listening is either live (Pause) or held (Play resumes it, Q3); while idle, Play starts one.
  const listening = t.active && !t.paused;
  const playPauseLabel = listening ? 'Pause' : 'Play';
  const playPauseDisabled = t.host.phase === 'starting' || t.host.phase === 'stopping' || (!t.active && !t.canStart);
  const onPlayPause = () => {
    if (!t.active)
      void recording.beforeStart().then((ok) => {
        if (ok) void t.start();
      });
    else t.pause(listening);
  };
  // Reading reached the end, or stopped itself there, while REAPER goes on recording the take this app started (Q8, Done
  // B, D28/D39): the app never cuts off a tail of room tone or an ad-lib, so the bar says so and Stop stays the way to end
  // it, highlighted (read-aloud-control-bar mock 10).
  const finishedRecording = recording.recording && (!t.active || t.session.position?.status === 'done');
  const onStop = () => {
    if (t.active) t.stop();
    recording.afterStop();
  };
  // Space toggles Play/Pause while this bar's booth scope is active (Phase 4, ADR 0361 decision 4, keeping ADR 0196
  // decision 5 unchanged): the router already applies the target guard, so a field, button, tab or other widget
  // still gets the key. Stop has no shortcut.
  useCommand('reading.toggle', () => {
    if (!playPauseDisabled) onPlayPause();
  });

  const micLabel = `Microphone: ${t.device || 'not chosen'}`;
  const engineOptions = t.engines.map((option) => ({ ...option, disabled: t.active }));
  const modelOptions = MODELS.map((option) => ({ value: option.value, label: option.label, title: option.caption, disabled: t.active }));

  return (
    // ≈64 px total (mock 03's command bar): a 32 px `Button`/`IconButton` row (`--button-height`) inside 16 px top/bottom
    // padding, plain Tailwind utilities rather than a new token (only Phase 0b may add one to styles.css).
    <Toolbar label="Reading controls" gapClassName="gap-x-4 gap-y-2" className="flex-wrap p-4">
      <div className="flex items-center gap-2">
        {/* `ToolbarButton` nests inside `TooltipTarget` here, not the other way round: `TooltipTarget` only ever nests its
            child as plain React children (never clones props onto it), so the real `Button` still gets the toolbar's roving
            tabindex/ARIA membership from `ToolbarButton`'s own `render` merge, while the disabled-reason hint keeps working. */}
        <TooltipTarget text={t.active ? playPauseLabel : t.startReason}>
          <ToolbarButton
            render={
              <Button aria-label={playPauseLabel} aria-pressed={listening} variant="secondary" onClick={onPlayPause} disabled={playPauseDisabled}>
                {/* The real, already-wired Space shortcut (`useCommand('reading.toggle', ...)` above), shown the way mock
                    03's command bar shows every action: a key cap beside its label (Phase 10's `KeyHint`, 23 px in the
                    command bar per `Kbd.tsx`). No other row here gets one - BO10's Punch & roll/Back one sentence/Flag/Mark
                    pickup keys have no bound command yet (booth-actions-enablement/input-commands), so inventing caps for
                    them would show a shortcut that does not exist.
                    `secondary`, not the default `primary`: `KeyHint`'s action label is a fixed `--text-muted`, which does
                    not clear contrast on `--accent`'s fill (caught by the visual suite's axe pass, ADR 0059). */}
                <KeyHint keys={['Space']} action={playPauseLabel} size="md" />
              </Button>
            }
          />
        </TooltipTarget>
        <ToolbarButton
          render={
            <Button
              aria-label="Stop reading"
              variant="danger"
              className={finishedRecording ? 'bg-[var(--badge-danger-fill)] ring-2 ring-[var(--danger)] ring-offset-1 ring-offset-[var(--surface)]' : undefined}
              onClick={onStop}
              disabled={(!t.active && !recording.recording) || t.host.phase === 'stopping'}
            >
              <FontAwesomeIcon icon={faStop} />
              <span className="hidden lg:inline">Stop reading</span>
            </Button>
          }
        />
      </div>

      <div className="order-first min-w-0 basis-full text-sm lg:order-none lg:flex-1 lg:basis-auto">
        <span
          role="status"
          className="font-semibold"
          style={{
            color:
              recording.error || finishedRecording
                ? 'var(--danger-text)'
                : t.session.position?.status === 'waiting' && t.active
                  ? 'var(--warn-text)'
                  : undefined,
          }}
        >
          {recording.error || (finishedRecording ? 'Reading finished. REAPER is still recording' : t.status || 'Ready')}
        </span>
        {t.session.script && (
          <span className="ml-2 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
            {t.session.cursor.toLocaleString()} of {t.session.script.tokens.toLocaleString()} words
          </span>
        )}
        {t.active && t.session.heard && (
          <span className="ml-2 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            Heard: {t.session.heard}
          </span>
        )}
        <div aria-live="polite" className="text-xs empty:hidden" style={{ color: 'var(--text-muted)' }}>
          {finishedRecording
            ? 'Press Stop when you are done; nothing is cut off until you do.'
            : t.active && !follow.following && 'Following paused. Scroll back to the highlighted word or press Follow.'}
        </div>
      </div>

      {!t.active && startPoint && (
        // Not a `StatusBadge`/`Badge`: its label is a quoted sentence fragment in normal running text (not a short
        // Barlow-Condensed-uppercase tag like "Pickup"), and it needs an interactive icon button nested inside it to clear
        // the point, which `Badge`'s API (a plain `label`/`icon`, or the whole badge as one `onClick`) has no room for.
        <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)' }}>
          <span className="truncate">Starts at &lsquo;{startPoint.label}&rsquo;</span>
          <IconButton label="Clear start point" onClick={startPoint.onClear} className="size-4 border-0 bg-transparent p-0 hover:bg-transparent">
            <FontAwesomeIcon icon={faXmark} className="text-[0.7rem]" />
          </IconButton>
        </span>
      )}

      {t.active && (
        // Always shown while a session runs, so it is where the narrator expects it; enabled only while following is paused.
        <ToolbarButton
          render={
            <Button aria-label="Follow" variant="secondary" onClick={follow.resume} disabled={follow.following}>
              <FontAwesomeIcon icon={faCrosshairs} />
              <span className="hidden lg:inline">Follow</span>
            </Button>
          }
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* The microphone and settings popovers wrap in `ToolbarButton` from the outside (`render={<Popover .../>}`), not
            the other way round: `Popover` needs its own `trigger` prop, which it clones its open/close props onto directly
            (the same mechanism `ToolbarButton` itself uses for `render`), so nesting a `ToolbarButton` inside that `trigger`
            would have `Popover` merge onto `ToolbarButton`'s own narrow prop set instead of the button, dropping the click
            handler that opens it (verified against this file's own popover-opens test before committing to this shape).
            Wrapping the whole `Popover` in `ToolbarButton` keeps the popover's own trigger wiring untouched - only the
            toolbar's own roving-tabindex props land on `Popover` and are harmlessly unused, same trade-off `RecordButton`
            below takes. */}
        <ToolbarButton
          render={
            <Popover
              label="Microphone"
              side="top"
              open={micOpen}
              onOpenChange={setMicOpen}
              trigger={
                <Button aria-label={micLabel} variant="secondary" className="max-w-[9rem] lg:max-w-[13rem]">
                  <FontAwesomeIcon icon={faMicrophone} />
                  <span className="truncate">{t.device || 'Choose a microphone…'}</span>
                  <LevelMeter label="Input level" peak={level?.peak ?? null} rms={level?.rms ?? null} decorative size="compact" className="w-8 flex-none" />
                </Button>
              }
            >
              <div className="w-72 space-y-2">
                <MicrophoneField
                  value={t.device}
                  onChange={t.changeDevice}
                  devices={t.devices}
                  error={t.devicesError}
                  onRefresh={t.loadDevices}
                  refreshing={t.devicesLoading}
                />
                <LevelMeter label="Input level" peak={level?.peak ?? null} rms={level?.rms ?? null} />
                {levelError && (
                  <p role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
                    {levelError}
                  </p>
                )}
              </div>
            </Popover>
          }
        />

        {recorder?.builtin ? (
          <ToolbarButton render={<RecordButton recorder={recorder} />} />
        ) : (
          chapterId && <ReaperStateIndicator chapterId={chapterId} chapterTitle={chapterTitle} chapterShortTitle={chapterShortTitle} recording={recording} />
        )}

        <ToolbarButton
          render={
            <Popover
              label="Settings"
              side="top"
              trigger={
                <IconButton label="Settings">
                  <FontAwesomeIcon icon={faGear} />
                </IconButton>
              }
            >
              <div className="flex w-64 flex-col gap-3">
                {engineOptions.length > 1 && (
                  <div>
                    <span className={LABEL_CLASS}>Engine</span>
                    <ToggleGroup label="Engine" className="mt-1.5 flex-wrap gap-1.5" value={t.engine} onChange={t.changeEngine} options={engineOptions} />
                  </div>
                )}
                <div>
                  <span className={LABEL_CLASS}>{engineOptions.length > 1 ? 'Model' : `${ENGINE_LABELS[t.engine]} model`}</span>
                  <ToggleGroup label="Model" className="mt-1.5 flex-wrap gap-1.5" value={t.model} onChange={t.changeModel} options={modelOptions} />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Used everywhere the app listens.{' '}
                  <Link to="/settings#booth" className="underline">
                    More in Settings
                  </Link>
                </p>
              </div>
            </Popover>
          }
        />
      </div>
    </Toolbar>
  );
}
