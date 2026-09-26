import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleDot, faCrosshairs, faGear, faMicrophone, faPause, faPlay, faRotate, faStop, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCommand } from '../../input/useCommand';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { Popover } from '../primitives/Popover';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TooltipTarget } from '../primitives/Tooltip';
import { InputLevelMeter } from './InputLevelMeter';
import { MicrophoneField } from './MicrophoneField';
import { useInputLevel } from './useInputLevel';
import { useReadAloudReaperState } from './useReadAloudReaperState';
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

/**
 * The read-only REAPER state the bar shows (read-aloud-control-bar.prd.md Phase 6, ADR 0249): whether the chapter's
 * linked track is the one track armed in REAPER, and whether it is recording. It is always disabled - Phase 7's
 * "Record in REAPER" toggle (arming, recording start and stop) is a later phase, not built here - so this is
 * information only, refreshed on mount and by its own Refresh button, never on a timer (ADR 0122).
 */
function ReaperStateIndicator({ chapterId }: { chapterId: string }) {
  const { state, error, refresh } = useReadAloudReaperState(chapterId);
  const message = state?.message ?? error ?? 'Checking REAPER…';
  const label = state ? `Record in REAPER: ${REAPER_STATUS_TEXT[state.status]}` : 'Record in REAPER';
  return (
    <div className="flex items-center gap-1">
      <TooltipTarget text={message}>
        <Button aria-label={label} variant="ghost" disabled className="max-w-[9rem] lg:max-w-[13rem]">
          <FontAwesomeIcon icon={faCircleDot} className={state?.recording ? 'text-[var(--danger-text)]' : undefined} />
          <span className="hidden truncate lg:inline">{state ? REAPER_STATUS_TEXT[state.status] : 'Record in REAPER'}</span>
        </Button>
      </TooltipTarget>
      <IconButton label="Refresh REAPER state" onClick={refresh}>
        <FontAwesomeIcon icon={faRotate} className="text-[0.7rem]" />
      </IconButton>
    </div>
  );
}

/**
 * The read-aloud media bar (read-aloud-control-bar.prd.md Phases 3-6), replacing the configuration `Panel`: a Play/Pause
 * toggle and Stop, status and word count, the start-point chip, Follow, a microphone popover (device list, Refresh and a
 * live level meter, Phase 4), the chapter's read-only REAPER state (Phase 6) and a Settings popover (Engine and Model).
 * Rendered outside the dialog's scrolling body (`Dialog`'s `footer` slot) or, on the standalone page, sticky at the bottom
 * of its own column (Q11), so it is never scrolled out of view. No "Record in REAPER" toggle yet (Q7-Q9, Phase 7): the
 * host actions it would call (arming, starting and stopping a REAPER recording) are not built.
 */
export function ReadingControlBar({ session: t, follow, startPoint, chapterId }: Props) {
  const [micOpen, setMicOpen] = useState(false);
  const { level, error: levelError } = useInputLevel(t.device, { active: t.active, enabled: micOpen });
  // While a session runs, listening is either live (Pause) or held (Play resumes it, Q3); while idle, Play starts one.
  const listening = t.active && !t.paused;
  const playPauseLabel = listening ? 'Pause' : 'Play';
  const playPauseDisabled = t.host.phase === 'starting' || t.host.phase === 'stopping' || (!t.active && !t.canStart);
  const onPlayPause = () => {
    if (!t.active) void t.start();
    else t.pause(listening);
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
        <Button aria-label="Stop reading" variant="danger" onClick={t.stop} disabled={!t.active || t.host.phase === 'stopping'}>
          <FontAwesomeIcon icon={faStop} />
          <span className="hidden lg:inline">Stop reading</span>
        </Button>
      </div>

      <div className="order-first min-w-0 basis-full text-sm lg:order-none lg:flex-1 lg:basis-auto">
        <span role="status" className="font-semibold" style={{ color: t.session.position?.status === 'waiting' && t.active ? 'var(--warn-text)' : undefined }}>
          {t.status || 'Ready'}
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
              <InputLevelMeter level={level} decorative className="w-8 flex-none" />
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
            <InputLevelMeter level={level} className="h-2.5" />
            {levelError && (
              <p role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
                {levelError}
              </p>
            )}
          </div>
        </Popover>

        {chapterId && <ReaperStateIndicator chapterId={chapterId} />}

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
