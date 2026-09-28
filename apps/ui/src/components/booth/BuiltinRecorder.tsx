import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleDot, faPlay, faStop, faWaveSquare } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useId, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { RecorderTake } from '../../api/contracts/recording';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { LevelMeter } from '../primitives/LevelMeter';
import { Panel } from '../primitives/Panel';
import { HeaderChip } from '../primitives/HeaderChip';
import { StatusBadge } from '../primitives/StatusBadge';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TooltipTarget } from '../primitives/Tooltip';
import { clockText } from './boothProgress';
import { MicrophoneField } from './MicrophoneField';
import type { Recorder } from './useRecorder';

// The Booth's built-in recorder (native-recording-suite PRD Phase 2, ADR 0455; D79: the Booth is the Record surface, no page
// of its own). Mock 03's Record area, with the built-in recorder in REAPER's place: the status line's "REC" badge, input
// meter and "−14.2 pk" readout and engine chip ("Built-in · take 4" where the mock reads "REAPER · take 4"), the command
// bar's Record toggle where "Record in REAPER" was, and the rail's session summary ("Recorded 41:12 · …") as the takes
// list. The pre-session setup gains "Record with" and, for the built-in recorder, its input device (the shared picker, Q6).

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';
const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

const ENGINE_OPTIONS = [
  { value: 'daw', label: 'REAPER' },
  { value: 'builtin', label: 'Built-in recorder' },
];

/** Whole seconds since `since` (Unix ms), ticking once a second; undefined while `since` is. */
function useElapsed(since: number | null | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null || since === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null || since === undefined ? undefined : Math.max(0, Math.floor((now - since) / 1000));
}

/** "−14.2 pk": the meter's held peak in dBFS, with a real minus sign (mock 03). */
export const peakText = (peak: number | null | undefined): string =>
  peak === null || peak === undefined || peak <= -100 ? '— pk' : `${peak < 0 ? '−' : ''}${Math.abs(peak).toFixed(1)} pk`;

/** The next take's number as the status chip shows it: the take recording, else one past the last. */
function takeLabel(recorder: Recorder): string {
  const state = recorder.state;
  if (state?.take) return state.take.replace(/^Take 0*/, 'take ');
  const count = state?.takes.length ?? 0;
  return count === 0 ? 'no takes yet' : `${count} ${count === 1 ? 'take' : 'takes'}`;
}

/**
 * The status line's recorder half (mock 03's top bar): the input meter with its peak readout, then the engine chip. The
 * meter reads the recorder's own level (it is metering or recording), so it is labelled here rather than decorative.
 */
export function RecorderStatus({ recorder }: { recorder: Recorder }) {
  const { level } = recorder;
  return (
    <>
      <span className="flex flex-none items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="max-sm:sr-only">Input</span>
        <LevelMeter label="Recorder input level" peak={level?.peak ?? null} rms={level?.rms ?? null} size="compact" className="w-10 sm:w-16 xl:w-24" />
        <span className={`${MONO} hidden whitespace-nowrap xl:inline`} aria-hidden="true">
          {peakText(level?.peak)}
        </span>
      </span>
      <HeaderChip
        role="group"
        aria-label={`Built-in recorder, ${takeLabel(recorder)}`}
        dot={recorder.recording ? 'var(--danger)' : 'var(--accent)'}
        short
        className="flex-none"
      >
        <span className="max-md:hidden">Built-in · {takeLabel(recorder)}</span>
      </HeaderChip>
    </>
  );
}

/** The command bar's Record toggle for the built-in recorder, in "Record in REAPER"'s place: "REC 00:42" while a take runs. */
export function RecordButton({ recorder }: { recorder: Recorder }) {
  const elapsed = useElapsed(recorder.state?.startedAt);
  const stopping = recorder.state?.phase === 'stopping';
  const rec = recorder.recording && elapsed !== undefined ? `REC ${clockText(elapsed, 2)}` : undefined;
  const reason = !recorder.device ? 'Choose the recorder’s input device first' : undefined;
  const label = stopping ? 'Record: finishing the take' : rec ? `Stop recording, ${clockText(elapsed!, 2)}` : 'Record a take';
  return (
    <TooltipTarget text={reason ?? (recorder.recording ? 'Stop the take and save it' : 'Record a take with the built-in recorder')}>
      <Button
        aria-label={label}
        aria-pressed={recorder.recording}
        variant={recorder.recording ? 'danger' : 'secondary'}
        onClick={recorder.toggleRecord}
        disabled={stopping || (!recorder.recording && !recorder.device)}
        pending={recorder.pending || stopping}
      >
        <FontAwesomeIcon icon={recorder.recording ? faStop : faCircleDot} className={recorder.recording ? undefined : 'text-[var(--danger-text)]'} />
        {rec ? <span className={`${MONO} text-xs whitespace-nowrap normal-case`}>{rec}</span> : <span className="hidden lg:inline">Record</span>}
      </Button>
    </TooltipTarget>
  );
}

/**
 * "Record with" (the pre-session setup): REAPER or the built-in recorder, the project's choice that also sets the engine
 * chip. The built-in recorder is Experimental (ADR 0357) and says so; for it, the input device (the teleprompter's picker,
 * Q6), a level check before the first take and where the takes are saved.
 */
export function RecorderSetup({ recorder }: { recorder: Recorder }) {
  const { state } = recorder;
  if (!state?.hasProject) return null;
  const unavailable = !state.support.available;
  const options = ENGINE_OPTIONS.map((option) => ({
    ...option,
    disabled: recorder.recording || (option.value === 'builtin' && unavailable),
    title: option.value === 'builtin' && unavailable ? state.support.message : undefined,
  }));
  return (
    <div className="mx-auto mb-4 w-full max-w-3xl">
      <Panel>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={LABEL_CLASS}>Record with</span>
          <ToggleGroup
            label="Record with"
            className="flex-wrap gap-1.5"
            value={state.engine}
            onChange={(value) => recorder.chooseEngine(value === 'builtin' ? 'builtin' : 'daw')}
            options={options}
          />
          {state.support.level === 'experimental' && <StatusBadge tone="experimental" label="Experimental" />}
        </div>
        {unavailable && state.support.message && (
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {state.support.message}
          </p>
        )}
        {recorder.builtin && (
          <div className="mt-3 space-y-2">
            <MicrophoneField
              id="recorder-device"
              label="Recorder input"
              blocks="Recording cannot start until a device is listed."
              value={recorder.device}
              onChange={recorder.chooseDevice}
              devices={recorder.devices}
              error={recorder.devicesError}
              onRefresh={recorder.loadDevices}
              refreshing={recorder.devicesLoading}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" aria-pressed={recorder.metering} onClick={recorder.toggleMeter} disabled={!recorder.device || recorder.recording}>
                <FontAwesomeIcon icon={faWaveSquare} />
                {recorder.metering ? 'Stop level check' : 'Check level'}
              </Button>
              <LevelMeter label="Recorder input level" peak={recorder.level?.peak ?? null} rms={recorder.level?.rms ?? null} className="min-w-[8rem] flex-1" />
            </div>
            <p className="text-xs [overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }}>
              Takes are saved as WAV files in <span className={MONO}>{state.folder}</span>. Listen through your interface’s direct monitoring.
            </p>
          </div>
        )}
        {recorder.error && (
          <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
            {recorder.error}
          </p>
        )}
      </Panel>
    </div>
  );
}

/** Plays one take through the media route: one take at a time, to its end. */
function useTakePlayer() {
  const api = useApi();
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const [playing, setPlaying] = useState<string>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => () => audio.current?.pause(), []);
  const element = () => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = 'none';
      audio.current.addEventListener('ended', () => setPlaying(undefined));
    }
    return audio.current;
  };
  return {
    playing,
    failed,
    toggle: (take: RecorderTake) => {
      const player = element();
      if (playing === take.path) {
        player.pause();
        setPlaying(undefined);
        return;
      }
      setFailed(undefined);
      player.src = api.mediaUrl(take.path);
      setPlaying(take.path);
      player.play().catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setPlaying(undefined);
        setFailed(take.path);
      });
    },
  };
}

const totalText = (takes: RecorderTake[]) => clockText(Math.round(takes.reduce((sum, take) => sum + take.seconds, 0)), 2);

/**
 * The rail's takes (mock 03's "This session: Recorded 41:12 · …"): what the built-in recorder has saved in this project,
 * newest first, each playable; an unfinished partial is marked, and the last take's problem (it ended by itself, or lost
 * audio) is said once.
 */
export function RecorderTakes({ recorder }: { recorder: Recorder }) {
  const headingId = useId();
  const player = useTakePlayer();
  const state = recorder.state;
  if (!state || !recorder.builtin) return null;
  const takes = [...state.takes].reverse();
  const last = state.last;
  const lastProblem =
    last && (last.error ?? (last.dropouts > 0 ? `${last.name} lost audio ${last.dropouts} ${last.dropouts === 1 ? 'time' : 'times'}.` : null));
  return (
    <section aria-labelledby={headingId} className="mb-4 space-y-1.5">
      <h2 id={headingId} className={SECTION_LABEL}>
        Takes
      </h2>
      <p className="text-sm">
        {state.takes.length === 0 ? (
          'No takes yet. Record starts the first.'
        ) : (
          <>
            Recorded <span className="font-semibold">{totalText(state.takes)}</span> · {state.takes.length} {state.takes.length === 1 ? 'take' : 'takes'}
          </>
        )}
      </p>
      {lastProblem && (
        <p role="status" className="text-xs" style={{ color: 'var(--warn-text)' }}>
          {lastProblem}
        </p>
      )}
      {state.message && state.message !== lastProblem && (
        <p role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
          {state.message}
        </p>
      )}
      {takes.length > 0 && (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {takes.map((take) => {
            const playing = player.playing === take.path;
            return (
              <li key={take.path} className="flex items-center gap-2 py-1">
                <IconButton size="sm" label={`${playing ? 'Stop' : 'Play'} ${take.name}`} aria-pressed={playing} onClick={() => player.toggle(take)}>
                  <FontAwesomeIcon icon={playing ? faStop : faPlay} />
                </IconButton>
                <span className="min-w-0 flex-1 truncate">{take.name}</span>
                {take.unfinished && <StatusBadge tone="warning" label="Unfinished" />}
                <span className={`${MONO} text-xs`} style={{ color: 'var(--text-muted)' }}>
                  {clockText(Math.round(take.seconds), 2)}
                </span>
                {player.failed === take.path && (
                  <span role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
                    Could not play
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
