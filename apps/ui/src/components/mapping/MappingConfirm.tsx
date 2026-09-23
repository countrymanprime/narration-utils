import { useEffect, useState } from 'react';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import type { Track } from '../../types';

type Props = {
  /** The chapter this link is for, used only to name the track picker for a screen reader. */
  chapterTitle: string;
  /** Every REAPER track the narrator can link to (analysis evidence ledger PRD, Phase 7, Q7). */
  tracks: Track[];
  /** The confirmed track's resolved name, when the link points at a track that still exists; omit it (leaving
   * `linkedTrackGuid` set) to show a missing-track state, or omit both to show nothing confirmed yet. */
  linkedTrackGuid?: string;
  linkedTrackName?: string;
  /** True while a confirm or clear call is in flight, so the caller's own state controls the busy affordance. */
  busy?: boolean;
  onConfirm: (trackGuid: string) => void;
  onClear: () => void;
};

// A reusable inline "link this chapter to a track" prompt (analysis evidence ledger PRD, Phase 7, Q7): the Tracks
// page's list uses one per chapter, and Home's recording check (components/home/RecordingCheck.tsx) shows one when a
// chapter has no confirmed track, without needing the Tracks page around it. It owns only the pending pick in the
// track dropdown; the confirmed link itself lives in the caller's state, refreshed from `chapterTrackMapList` after
// `onConfirm`/`onClear` resolve.
export function MappingConfirm({ chapterTitle, tracks, linkedTrackGuid, linkedTrackName, busy = false, onConfirm, onClear }: Props) {
  const hasLink = Boolean(linkedTrackGuid);
  const [picking, setPicking] = useState(!hasLink);
  const options = tracks.map((track) => ({ value: track.guid, label: track.name || `Track ${track.index + 1}` }));
  const [chosen, setChosen] = useState(linkedTrackGuid && tracks.some((track) => track.guid === linkedTrackGuid) ? linkedTrackGuid : (options[0]?.value ?? ''));

  // A confirm or clear call comes back through the caller's own state, as a new `linkedTrackGuid` prop, not through
  // this component's local `picking` intent: once the caller reports a link (a fresh confirm, or a Change followed
  // by a new confirm), drop back to the read view so a completed confirm does not keep showing its own form.
  useEffect(() => {
    if (hasLink) setPicking(false);
  }, [hasLink, linkedTrackGuid]);

  if (hasLink && !picking) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{linkedTrackName ?? 'Linked track is missing from this project'}</span>
        <Button variant="ghost" onClick={() => setPicking(true)} disabled={busy}>
          Change
        </Button>
        <Button variant="ghost" onClick={onClear} pending={busy}>
          Clear
        </Button>
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No REAPER tracks to link
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select label={`Track for ${chapterTitle}`} value={chosen} onChange={setChosen} options={options} />
      <Button onClick={() => onConfirm(chosen)} pending={busy}>
        Confirm
      </Button>
      {hasLink && (
        <Button variant="ghost" onClick={() => setPicking(false)} disabled={busy}>
          Cancel
        </Button>
      )}
    </div>
  );
}
