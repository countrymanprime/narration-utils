import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import type { WorkspaceToken } from '../../api/contracts/workspace';
import type { Flag, FlagKind } from './flags';

const KIND_ORDER: FlagKind[] = ['skip', 'partial', 'not_recorded', 'misread', 'extra'];

function countByKind(flags: readonly Flag[]): Array<{ kind: FlagKind; label: string; count: number }> {
  const counts = new Map<FlagKind, { label: string; count: number }>();
  flags.forEach((flag) => {
    const existing = counts.get(flag.kind);
    if (existing) existing.count += 1;
    else counts.set(flag.kind, { label: flag.label, count: 1 });
  });
  return KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({ kind, ...counts.get(kind)! }));
}

/**
 * The workspace's flag legend and detail (edit-and-proof-workspace.prd.md Phase 2, EP4): counts by kind, next and
 * previous navigation over every flag in the chapter, and the selected flag's script/heard text. Reviewing a flag
 * (accept, dismiss, defer, note) is Phase 4's job, once a flag is backed by an actual Finding the app can act on -
 * this Phase's flags come straight from the stored alignment, read-only. Likewise "Go to in REAPER" and "Loop" for
 * a flag are Phase 3 (new bindings that don't exist yet): only "Play from here" (the app's own player) is offered.
 */
export function FlagsPanel({
  flags,
  tokens,
  selectedIndex,
  onSelect,
  onPlayFromFlag,
}: {
  flags: readonly Flag[];
  tokens: readonly WorkspaceToken[];
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
  onPlayFromFlag: (flag: Flag) => void;
}) {
  const selected = selectedIndex !== undefined ? flags[selectedIndex] : undefined;
  const scriptWords = selected ? tokens.slice(selected.tokenStart, selected.tokenEnd + 1).map((token) => token.text) : [];

  return (
    <Panel title={`Flags · ${flags.length}`}>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        What Whisper heard, not proof. From the chapter&rsquo;s last check.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {countByKind(flags).map(({ kind, label, count }) => (
          <li key={kind} className="flex items-center justify-between">
            <span>{label}</span>
            <span style={{ color: 'var(--text-muted)' }}>{count}</span>
          </li>
        ))}
        {flags.length === 0 && <li style={{ color: 'var(--text-muted)' }}>No flags on this chapter&rsquo;s current check.</li>}
      </ul>
      {flags.length > 0 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            aria-label="Previous flag"
            disabled={selectedIndex === undefined || selectedIndex <= 0}
            onClick={() => selectedIndex !== undefined && onSelect(selectedIndex - 1)}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </Button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {selectedIndex !== undefined ? `Flag ${selectedIndex + 1} of ${flags.length}` : `${flags.length} flag${flags.length === 1 ? '' : 's'}`}
          </span>
          <Button
            variant="ghost"
            aria-label="Next flag"
            disabled={selectedIndex === undefined ? flags.length === 0 : selectedIndex >= flags.length - 1}
            onClick={() => onSelect(selectedIndex === undefined ? 0 : selectedIndex + 1)}
          >
            <FontAwesomeIcon icon={faChevronRight} />
          </Button>
        </div>
      )}
      {selected && (
        <div className="mt-4 space-y-2 border-t pt-3 text-sm" style={{ borderColor: 'var(--border)' }}>
          <div className="font-semibold">{selected.label}</div>
          <div>
            <span className="section-label">Script</span> &ldquo;{scriptWords.join(' ')}&rdquo;
          </div>
          {selected.heard && (
            <div>
              <span className="section-label">Heard</span> &ldquo;{selected.heard}&rdquo;
            </div>
          )}
          <Button variant="ghost" disabled={selected.seekTokenIndex === undefined} onClick={() => onPlayFromFlag(selected)}>
            Play from here
          </Button>
        </div>
      )}
    </Panel>
  );
}
