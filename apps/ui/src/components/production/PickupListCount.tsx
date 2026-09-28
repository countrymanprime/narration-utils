import { Link } from 'react-router-dom';
import { InsetCard } from '../primitives/InsetCard';

/**
 * RS5 B (recording-check-summary.prd.md Phase 3, D22): the proofer's REAPER pickup list, shown project-wide rather
 * than scoped to the chapter - attributing `PICKUP:` markers to one chapter's linked track span (RS5 A) is
 * ambiguous when chapter tracks overlap in time, and needs the owner's real project layout to be safe. `remaining`
 * is the same figure the Pickups page (`/pickups`, stage-navigation-and-page-replacement.prd.md Phase 7) shows, from the bridge's `pickupsCount`/`pickupsState`; that needs
 * REAPER running, so `available` false (the `pickups` DAW capability) reads a plain instruction instead of a stale
 * or wrong number. Always shown, like `TakeReviewPickups` above it, so the narrator can tell there is nothing to
 * chase rather than a missing line (RS8: its own label, a different pickup source from the check's own gaps).
 */
export function PickupListCount({ available, remaining }: { available: boolean; remaining?: number }) {
  return (
    <InsetCard dashed className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>Pickup list: {available ? `${remaining ?? 0} open (project-wide)` : 'open REAPER to count'}</span>
      {available && (
        <Link to="/pickups" className="font-semibold underline">
          Open pickups
        </Link>
      )}
    </InsetCard>
  );
}
