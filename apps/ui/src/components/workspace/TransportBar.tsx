import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBackward, faForward, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import { Panel } from '../primitives/Panel';
import { formatDuration, formatElapsed } from './format';
import { SKIP_SECONDS, SPEED_OPTIONS, type PlaybackSpeed } from './useChapterPlayback';

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

/** The chapter workspace's transport (edit-and-proof-workspace.prd.md Phase 2, EP17): play/pause, back and forward
 * SKIP_SECONDS, the app's own elapsed/duration readout, and the narrator's pitch-kept speed. Built on
 * `useChapterPlayback`, not `useTrackPlayback` - a chapter plays a whole track's items honouring their trims, not
 * one item at a time with track-to-track navigation. */
export function TransportBar({ player }: { player: TransportBarPlayer }) {
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
        <Button variant="ghost" onClick={player.skipBack} disabled={!player.canPlay} aria-label={`Skip back ${SKIP_SECONDS} seconds`}>
          <FontAwesomeIcon icon={faBackward} /> {SKIP_SECONDS}s
        </Button>
        <Button onClick={player.togglePlay} disabled={!player.canPlay} aria-label={player.isPlaying ? 'Pause' : 'Play'}>
          <FontAwesomeIcon icon={player.isPlaying ? faPause : faPlay} />
        </Button>
        <Button variant="ghost" onClick={player.skipForward} disabled={!player.canPlay} aria-label={`Skip forward ${SKIP_SECONDS} seconds`}>
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
      </div>
    </Panel>
  );
}
