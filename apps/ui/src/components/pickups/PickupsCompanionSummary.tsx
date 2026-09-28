import { usePickupsState } from './usePickupsState';

/**
 * The Booth companion's Pickups section (stage-navigation-and-page-replacement.prd.md Phase 7): the same pickup list the
 * Pickups page works through, read-only at 380 px - how many are left and the one last jumped to. Jumping, punching and
 * marking one done stay on the page; closed-loop proofing's session plan replaces this once it exists.
 */
export function PickupsCompanionSummary() {
  const state = usePickupsState();
  const next = state.phase === 'success' ? state.next : undefined;
  return (
    <div className="flex flex-col gap-1">
      <p>{state.total > 0 ? `${state.remaining} pickup${state.remaining === 1 ? '' : 's'} remaining of ${state.total}` : 'No pickups yet'}</p>
      {next && (
        <p>
          Next: {next.tag && <span className="section-label mr-1.5">{next.tag}</span>}
          {next.note}
        </p>
      )}
      <p style={{ color: 'var(--text-muted)' }}>Jump to one or mark it done on the Pickups page in the full app.</p>
    </div>
  );
}
