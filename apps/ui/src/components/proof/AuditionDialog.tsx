import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import { Checkbox } from '../primitives/Checkbox';
import { AUDITION_POST_ROLL_SECONDS, AUDITION_PRE_ROLL_SECONDS, useRangePlayer, type AuditionRange } from '../tracks/useRangePlayer';
import { sourceFileName } from './takeReviewFormat';
import type { TakeReviewMember } from '../../types';

/** What a read needs to be auditioned: where it is in its own source file. */
export type AuditionSource = Pick<TakeReviewMember, 'source_file' | 'source_start' | 'source_length'>;

/** How a read is named in the pickers, unless the caller names it: its number and file. */
const defaultLabel = (member: AuditionSource, index: number): string => `Read ${index + 1} — ${sourceFileName(member.source_file)}`;

function rangeFor(member: AuditionSource | undefined): AuditionRange | undefined {
  if (!member) return undefined;
  return { sourceFile: member.source_file, rangeStart: member.source_start, rangeEnd: member.source_start + member.source_length };
}

// A read is chosen by its place in the finding: two takes of one item share an item GUID, so the GUID cannot name a read.
type SideProps = {
  side: 'A' | 'B';
  members: AuditionSource[];
  label: (index: number) => string;
  selected: number;
  onSelect: (read: number) => void;
  player: ReturnType<typeof useRangePlayer>;
  onToggle: () => void;
};

function AuditionSide({ side, members, label, selected, onSelect, player, onToggle }: SideProps) {
  const member = members[selected];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Read {side}</span>
        <Button variant="ghost" onClick={onToggle} disabled={!member} aria-label={`${player.isPlaying ? 'Pause' : 'Play'} read ${side}`}>
          <FontAwesomeIcon icon={player.isPlaying ? faPause : faPlay} />
        </Button>
      </div>
      <Select
        label={`Read ${side}`}
        value={String(selected)}
        onChange={(value) => onSelect(Number(value))}
        fullWidth
        options={members.map((_, index) => ({ value: String(index), label: label(index) }))}
      />
      <Checkbox checked={player.loop} onChange={player.setLoop}>
        Loop
      </Checkbox>
      {player.loadError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          This read&rsquo;s audio couldn&rsquo;t be played. Check that its source file is still where the project expects it.
        </p>
      )}
    </div>
  );
}

/**
 * Side-by-side A/B audition (phase 7 of take-review-pickups-duplicates-take-intelligence.prd.md,
 * Q7 option A), opened from a take-review finding on the Review page (phase 5): plays two of the finding's own reads from their own raw source file, each with a
 * fixed pre/post roll, over the same `/media` route the Tracks page player streams from
 * (apps/desktop/media.go's authorizedMediaSource already covers every take's own source, phase 2).
 * No REAPER mutation happens here at all - this is read-only playback of files the app already has
 * access to - and only one side plays at a time, so switching between A and B is a real comparison
 * rather than two overlapping streams. Each read's processing chain in REAPER may differ from what
 * plays here, so the dialog says so plainly (the risk the PRD names under "Comparing takes across
 * different processing chains misleads").
 */
export function AuditionDialog<T extends AuditionSource>({
  members,
  label = defaultLabel,
  onClose,
}: {
  members: T[];
  /** How a read is named in the Read A and Read B pickers; its number and file when not given. */
  label?: (member: T, index: number) => string;
  onClose: () => void;
}) {
  const nameOf = (index: number) => label(members[index], index);
  const api = useApi();
  const [a, setA] = useState(0);
  const [b, setB] = useState(members.length > 1 ? 1 : 0);

  const playerA = useRangePlayer(api.mediaUrl);
  const playerB = useRangePlayer(api.mediaUrl);

  const rangeA = rangeFor(members[a]);
  const rangeB = rangeFor(members[b]);

  const toggleA = () => {
    if (playerA.isPlaying) {
      playerA.stop();
    } else if (rangeA) {
      playerB.stop();
      playerA.play(rangeA);
    }
  };
  const toggleB = () => {
    if (playerB.isPlaying) {
      playerB.stop();
    } else if (rangeB) {
      playerA.stop();
      playerB.play(rangeB);
    }
  };

  return (
    <Dialog title="Audition candidate reads" onClose={onClose} actions={null}>
      <p className="font-semibold" style={{ color: 'var(--danger-text)' }}>
        Raw source, no FX or edits applied
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Each read plays straight from its own source file, with about {AUDITION_PRE_ROLL_SECONDS}s before and {AUDITION_POST_ROLL_SECONDS}s after the matched
        span. REAPER&rsquo;s processing chain (FX, gain, edits) is not applied, so this can sound different from the project.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AuditionSide side="A" members={members} label={nameOf} selected={a} onSelect={setA} player={playerA} onToggle={toggleA} />
        <AuditionSide side="B" members={members} label={nameOf} selected={b} onSelect={setB} player={playerB} onToggle={toggleB} />
      </div>
    </Dialog>
  );
}
