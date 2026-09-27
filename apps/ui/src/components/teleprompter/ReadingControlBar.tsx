import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleDot, faCrosshairs, faGear, faLock, faMicrophone, faPause, faPlay, faRotate, faStop, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCommand } from '../../input/useCommand';
import { useCapability } from '../../useCapability';
import { Button } from '../primitives/Button';
import { CapabilityGate, type CapabilityEntry } from '../primitives/CapabilityGate';
import { IconButton } from '../primitives/IconButton';
import { LevelMeter } from '../primitives/LevelMeter';
import { Popover } from '../primitives/Popover';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TooltipTarget } from '../primitives/Tooltip';
import { MicrophoneField } from './MicrophoneField';
import { useInputLevel } from './useInputLevel';
import { useReadAloudReaperState } from './useReadAloudReaperState';
import type { RecordInReaperState } from './useRecordInReaper';
import type { FollowCursor } from './useFollowCursor';
import { ENGINE_LABELS, MODELS, type TeleprompterSession } from './useTeleprompterSession';
import type { ReadAloudReaperState } from '../../types';

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
  /** The Record-in-REAPER toggle's state and Play/Stop orchestration (Phase 7, `useRecordInReaper`), owned by
   * ReadAloudDialog since its own "Stop reading?" confirm also needs to stop a recording this app started. */
  recording?: RecordInReaperState;
};

// A do-nothing RecordInReaperState for the standalone page (Q11 A: no REAPER toggle there, TeleprompterPage.tsx never
// passes `recording`), so Play and Stop orchestrate nothing rather than needing a null check at every call site.
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

const REAPER_STATUS_TEXT: Record<ReadAloudReaperState['status'], string> = {
  ready: 'Chapter armed',
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
function ReaperStateIndicator({ chapterId, chapterTitle, recording }: { chapterId: string; chapterTitle?: string; recording: RecordInReaperState }) {
  const { state, error, refresh } = useReadAloudReaperState(chapterId);
  const record = useCapability('record');
  const label = state ? `Record in REAPER: ${REAPER_STATUS_TEXT[state.status]}` : 'Record in REAPER';
  const capability: CapabilityEntry = record.available ? { ...record, message: state?.message ?? error ?? 'Checking REAPER…' } : record;
  const armLabel = chapterTitle ? `Arm "${chapterTitle}" only` : 'Arm this chapter only';
  return (
    <div className="flex items-center gap-1">
      <CapabilityGate capability={capability}>
        <Button aria-label={label} aria-pressed={recording.enabled} variant="ghost" className="max-w-[9rem] lg:max-w-[13rem]" onClick={recording.toggle}>
          <FontAwesomeIcon icon={faCircleDot} className={state?.recording ? 'text-[var(--danger-text)]' : undefined} />
          <span className="hidden truncate lg:inline">{state ? REAPER_STATUS_TEXT[state.status] : 'Record in REAPER'}</span>
        </Button>
      </CapabilityGate>
      {recording.enabled && state && ARMABLE_STATUSES.has(state.status) && (
        <Button aria-label={armLabel} variant="ghost" onClick={() => void recording.armOnly().then(refresh)} disabled={recording.armPending}>
          <FontAwesomeIcon icon={faLock} />
          <span className="hidden lg:inline">Arm only</span>
        </Button>
      )}
      <IconButton label="Refresh REAPER state" onClick={refresh}>
        <FontAwesomeIcon icon={faRotate} className="text-[0.7rem]" />
      </IconButton>
    </div>
  );
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
 */
export function ReadingControlBar({ session: t, follow, startPoint, chapterId, chapterTitle, recording = NO_RECORDING }: Props) {
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
  const onStop = () => {
    t.stop();
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
    <div role="toolbar" aria-label="Reading controls" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <TooltipTarget text={t.active ? playPauseLabel : t.startReason}>
          <Button aria-label={playPauseLabel} aria-pressed={listening} onClick={onPlayPause} disabled={playPauseDisabled}>
            <FontAwesomeIcon icon={listening ? faPause : faPlay} />
            <span className="hidden lg:inline">{playPauseLabel}</span>
          </Button>
        </TooltipTarget>
        <Button aria-label="Stop reading" variant="danger" onClick={onStop} disabled={!t.active || t.host.phase === 'stopping'}>
          <FontAwesomeIcon icon={faStop} />
          <span className="hidden lg:inline">Stop reading</span>
        </Button>
      </div>

      <div className="order-first min-w-0 basis-full text-sm lg:order-none lg:flex-1 lg:basis-auto">
        <span
          role="status"
          className="font-semibold"
          style={{ color: recording.error ? 'var(--danger-text)' : t.session.position?.status === 'waiting' && t.active ? 'var(--warn-text)' : undefined }}
        >
          {recording.error || t.status || 'Ready'}
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
          {t.active && !follow.following && 'Following paused. Scroll back to the highlighted word or press Follow.'}
        </div>
      </div>

      {!t.active && startPoint && (
        <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)' }}>
          <span className="truncate">Starts at &lsquo;{startPoint.label}&rsquo;</span>
          <IconButton label="Clear start point" onClick={startPoint.onClear} className="size-4 border-0 bg-transparent p-0 hover:bg-transparent">
            <FontAwesomeIcon icon={faXmark} className="text-[0.7rem]" />
          </IconButton>
        </span>
      )}

      {t.active && (
        // Always shown while a session runs, so it is where the narrator expects it; enabled only while following is paused.
        <Button aria-label="Follow" variant="ghost" onClick={follow.resume} disabled={follow.following}>
          <FontAwesomeIcon icon={faCrosshairs} />
          <span className="hidden lg:inline">Follow</span>
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Popover
          label="Microphone"
          side="top"
          open={micOpen}
          onOpenChange={setMicOpen}
          trigger={
            <Button aria-label={micLabel} variant="ghost" className="max-w-[9rem] lg:max-w-[13rem]">
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

        {chapterId && <ReaperStateIndicator chapterId={chapterId} chapterTitle={chapterTitle} recording={recording} />}

        <Popover
          label="Settings"
          side="top"
          align="end"
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
              <Link to="/settings#teleprompter" className="underline">
                More in Settings
              </Link>
            </p>
          </div>
        </Popover>
      </div>
    </div>
  );
}
