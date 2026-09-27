import { TooltipTarget } from '../primitives/Tooltip';

// The header's audio-engine indicator (stage-navigation-and-page-replacement.prd.md Phase 1, ADR 0407 item 4),
// replacing the REAPER link pill in place: same styled button, same click action (today's link/relink flow; the
// engine panel opens from here from Phase 6), same three REAPER states, plus a fourth the UI can draw but that
// nothing selects yet ('builtin', Q7) - the native recording suite's own binding chooses it later.
export type EngineState = 'daw' | 'builtin';

export function EngineChip({
  engine = 'daw',
  dawFileLinked,
  dawReachable = false,
  dawProjectMatches = false,
  onLinkDawFile,
  linkingDawFile = false,
}: {
  /** Which engine backs this project (Q7); the UI defaults to 'daw' until native recording picks 'builtin'. */
  engine?: EngineState;
  dawFileLinked: boolean;
  /** Whether a live REAPER heartbeat has been seen recently (Phase 7, ADR 0092); false also covers "unknown". */
  dawReachable?: boolean;
  /** Whether that heartbeat's open project is the linked file (Phase 7); only meaningful when dawReachable is true. */
  dawProjectMatches?: boolean;
  onLinkDawFile: () => void;
  /** True while the shared DAW-link binding is running for any of its three call sites (ADR 0075's ref guard). */
  linkingDawFile?: boolean;
}) {
  if (engine === 'builtin') {
    return (
      // role="group" (not a plain span): aria-label is only permitted on an element whose role supports naming, and
      // below `md` the visible text hides, leaving the dot as the chip's only content (axe aria-prohibited-attr).
      <span
        role="group"
        aria-label="Built-in recorder"
        className="inline-flex items-center gap-[0.4rem] rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-[0.6rem] py-[0.2rem] font-['Barlow_Condensed',sans-serif] text-[0.8rem] font-semibold tracking-[0.03em] max-md:px-[0.35rem]"
      >
        <span className="size-[7px] flex-none rounded-full" style={{ backgroundColor: 'var(--accent)', boxShadow: '0 0 5px var(--accent)' }} />
        <span className="max-md:hidden">Built-in recorder</span>
      </span>
    );
  }
  const dawMismatch = dawFileLinked && dawReachable && !dawProjectMatches;
  const label = dawMismatch ? 'Wrong REAPER project open' : dawFileLinked ? 'REAPER project linked' : 'No REAPER project linked';
  const tooltip = dawMismatch
    ? 'REAPER has a different project open than the one linked here. Click to link the open project, or switch REAPER to the linked file.'
    : dawFileLinked
      ? 'Change the linked REAPER project (.rpp) file'
      : 'Link a REAPER project (.rpp) file';
  const dotStyle = dawMismatch
    ? { backgroundColor: 'var(--warn)', boxShadow: '0 0 5px var(--warn)' }
    : dawFileLinked
      ? { backgroundColor: 'var(--character)', boxShadow: '0 0 5px var(--character)' }
      : { backgroundColor: 'var(--non-text)' };
  return (
    <TooltipTarget text={tooltip}>
      <button
        type="button"
        onClick={onLinkDawFile}
        disabled={linkingDawFile}
        aria-busy={linkingDawFile || undefined}
        aria-label={`${label} — ${tooltip}`}
        className="inline-flex items-center gap-[0.4rem] rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-[0.6rem] py-[0.2rem] font-['Barlow_Condensed',sans-serif] text-[0.8rem] font-semibold tracking-[0.03em] hover:border-[var(--accent)] disabled:pointer-events-none disabled:opacity-60 max-md:px-[0.35rem]"
      >
        <span className="size-[7px] flex-none rounded-full" style={dotStyle} />
        {/* Below `md` the chip shortens to its dot; the full text stays in the accessible name above (app-navigation Q10 A). */}
        <span className="max-md:hidden">{label}</span>
      </button>
    </TooltipTarget>
  );
}
