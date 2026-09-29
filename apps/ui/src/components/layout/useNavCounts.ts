import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';

/** The rail's count badges (mock 05: "3" on Story Bible, "14" on Proof, "9" on Pickups). A key is absent when the host has no
 * count to give, and the rail then draws no badge: a number is never made up. */
/** The category the Story Bible files an entry under until the narrator gives it a real one (the "Needs Review" tab). */
const NEEDS_REVIEW = 'Needs Review';

export type NavCounts = { storyBible?: number; proof?: number; pickups?: number };

/**
 * What waits on each page, read from the host: the Story Bible's Needs Review entries (the names the build pulled in that nobody has
 * sorted into a category yet, the number its own "Needs Review" tab shows, ADR 0746), the notes still to review (Proof's summary)
 * and the pickups REAPER last reported remaining. It reads again on
 * every page move, so a decision made on a page shows on the rail as the narrator leaves it. It only reads: the pickups count
 * is what REAPER last reported, and the hook never asks REAPER to count.
 */
export function useNavCounts(pathname: string, hasManuscript: boolean): NavCounts {
  const api = useApi();
  const [counts, setCounts] = useState<NavCounts>({});

  useEffect(() => {
    let active = true;
    const set = (patch: NavCounts) => active && setCounts((previous) => ({ ...previous, ...patch }));
    const clear = (key: keyof NavCounts) => () => set({ [key]: undefined });
    if (hasManuscript) {
      api
        .guideEntities()
        .then((entities) => set({ storyBible: entities.filter((entity) => entity.category === NEEDS_REVIEW).length }))
        .catch(clear('storyBible'));
    } else {
      set({ storyBible: undefined });
    }
    api
      .findingsSummary()
      .then((summary) => set({ proof: summary.unreviewed }))
      .catch(clear('proof'));
    api
      .pickupsState()
      .then((state) => set({ pickups: state.remaining }))
      .catch(clear('pickups'));
    const unsubscribe = api.subscribePickups((state) => set({ pickups: state.remaining }));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, pathname, hasManuscript]);

  return counts;
}
