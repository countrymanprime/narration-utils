import { Kbd, type KbdSize } from './Kbd';

// A key cap with its action spelled out beside it (mock-fidelity-primitives-and-components.prd.md Phase 10, mock 03's
// command bar): the cap, 10 px, then the action in Plex Sans, muted. `Kbd` already names itself for a screen reader
// (its `keys`, or `spokenLabel` for a symbol), so the visible `action` text beside it needs no extra wrapper role.
export function KeyHint({
  keys,
  action,
  spokenLabel,
  size = 'sm',
  className = '',
}: {
  keys: string[];
  // The visible label naming what the key does (mock 03: "Play", "Record", ...).
  action: string;
  // Overrides Kbd's own spoken name for a symbol key; see `Kbd`'s `label`.
  spokenLabel?: string;
  size?: KbdSize;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-[0.625rem] ${className}`}>
      <Kbd keys={keys} label={spokenLabel} size={size} />
      <span className="font-['IBM_Plex_Sans',ui-sans-serif,sans-serif] text-[0.8125rem] text-[var(--text-muted)]">{action}</span>
    </span>
  );
}
