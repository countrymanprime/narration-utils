import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBackward, faForward, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { Select } from '../primitives/Select';
import { Panel } from '../primitives/Panel';
import { TooltipTarget } from '../primitives/Tooltip';
import { formatDuration, formatElapsed } from './format';
import { SKIP_SECONDS, SPEED_OPTIONS, type PlaybackSpeed } from './useChapterPlayback';
import type { WorkspaceReaperControls } from './useWorkspaceReaper';

const SPEED_LABEL: Record<PlaybackSpeed, string> = { 0.75: '0.75×', 1: '1×', 1.25: '1.25×', 1.5: '1.5×', 1.75: '1.75×', 2: '2×' };

export type TransportBarPlayer = {
  isPlaying: boolean;
  elapsed: number;
  duration: number;
  canPlay: boolean;
  loadError: boolean;
  speed: PlaybackSpeed;
  togglePlay: () => void;
  skipBack: () => void;
  skipForward: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
};

/** The chapter workspace's transport (edit-and-proof-workspace.prd.md Phase 2, EP17; Phase 3 Go to/Loop): play/pause,
 * back and forward SKIP_SECONDS, the app's own elapsed/duration readout, the narrator's pitch-kept speed, and Go to
 * and Loop in REAPER for the word currently at the playhead (mockups/edit-and-proof-workspace/03-click-word-to-seek.webp,
 * "GO TO IN REAPER"). Built on `useChapterPlayback`, not `useTrackPlayback` - a chapter plays a whole track's items
 * honouring their trims, not one item at a time with track-to-track navigation. */
export function TransportBar({ player, reaper }: { player: TransportBarPlayer; reaper: WorkspaceReaperControls }) {
  return (
    <Panel>
      {player.loadError && (
        <p role="alert" className="mb-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          This chapter&rsquo;s audio couldn&rsquo;t be played. Check that its source files are still where the project expects them.
        </p>
      )}
      {!player.canPlay && !player.loadError && (
        <p className="mb-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          This chapter has no playable audio yet.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="secondary" onClick={player.skipBack} disabled={!player.canPlay} aria-label={`Skip back ${SKIP_SECONDS} seconds`}>
          <FontAwesomeIcon icon={faBackward} /> {SKIP_SECONDS}s
        </Button>
        <IconButton variant="primary" onClick={player.togglePlay} disabled={!player.canPlay} label={player.isPlaying ? 'Pause' : 'Play'}>
          <FontAwesomeIcon icon={player.isPlaying ? faPause : faPlay} />
        </IconButton>
        <Button variant="secondary" onClick={player.skipForward} disabled={!player.canPlay} aria-label={`Skip forward ${SKIP_SECONDS} seconds`}>
          {SKIP_SECONDS}s <FontAwesomeIcon icon={faForward} />
        </Button>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatElapsed(player.elapsed)} / {formatDuration(player.duration)}
        </span>
        <Select
          label="Playback speed"
          value={String(player.speed)}
          onChange={(value) => player.setSpeed(Number(value) as PlaybackSpeed)}
          options={SPEED_OPTIONS.map((speed) => ({ value: String(speed), label: SPEED_LABEL[speed] }))}
        />
        <TooltipTarget text={reaper.goToBlocked ?? "Select this word's item in REAPER and put the edit cursor on it"}>
          <Button
            variant="secondary"
            onClick={() => void reaper.goTo()}
            disabled={Boolean(reaper.goToBlocked) || reaper.pending !== undefined}
            pending={reaper.pending === 'goTo'}
          >
            Go to in REAPER
          </Button>
        </TooltipTarget>
        {reaper.looping ? (
          <Button variant="secondary" onClick={() => void reaper.stopLoop()} disabled={reaper.pending !== undefined} pending={reaper.pending === 'stop'}>
            Stop loop
          </Button>
        ) : (
          <TooltipTarget text={reaper.loopBlocked ?? 'Play this word over and over in REAPER'}>
            <Button
              variant="secondary"
              onClick={() => void reaper.loop()}
              disabled={Boolean(reaper.loopBlocked) || reaper.pending !== undefined}
              pending={reaper.pending === 'loop'}
            >
              Loop in REAPER
            </Button>
          </TooltipTarget>
        )}
      </div>
      {reaper.message && (
        <p role="alert" className="mt-2 text-center text-sm" style={{ color: 'var(--danger-text)' }}>
          {reaper.message}
        </p>
      )}
    </Panel>
  );
}
