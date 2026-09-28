import { usePickupsState } from './usePickupsState';

// Mock 07's pickups list: Plex Mono, 13 px, 29 px rows (mock-fidelity-primitives-and-components.prd.md Phase 13). The
// same mono family other dense rows already use (Kbd.tsx, KeyHint.tsx).
const ROW = "flex min-h-[1.8125rem] items-center font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem]";

/**
 * The Booth companion's Pickups section (stage-navigation-and-page-replacement.prd.md Phase 7): the same pickup list the
 * Pickups page works through, read-only at 380 px - how many are left and the one last jumped to. Jumping, punching and
 * marking one done stay on the page; closed-loop proofing's session plan replaces this once it exists.
 */
export function PickupsCompanionSummary() {
  const state = usePickupsState();
  const next = state.phase === 'success' ? state.next : undefined;
  return (
    <div className="flex flex-col">
      <p className={ROW}>{state.total > 0 ? `${state.remaining} pickup${state.remaining === 1 ? '' : 's'} remaining of ${state.total}` : 'No pickups yet'}</p>
      {next && (
        <p className={ROW}>
          Next: {next.tag && <span className="section-label mr-1.5">{next.tag}</span>}
          {next.note}
        </p>
      )}
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Jump to one or mark it done on the Pickups page in the full app.
      </p>
    </div>
  );
}
