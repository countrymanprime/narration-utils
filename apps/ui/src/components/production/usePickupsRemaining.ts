import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';

/** The pickup list as REAPER last reported it; `undefined` until a count has been reported. */
export type PickupsRemaining = { remaining: number; total: number } | undefined;

/**
 * The open-pickups figure on Production's tile: what REAPER last reported, from the host's stored state and the live event. It only
 * reads (like the rail's badge): counting is a REAPER round trip the Pickups page makes, so a figure nobody has counted is
 * `undefined`, drawn as a dash, never 0.
 */
export function usePickupsRemaining(): PickupsRemaining {
  const api = useApi();
  const [known, setKnown] = useState<PickupsRemaining>();

  useEffect(() => {
    let active = true;
    const take = (state: { phase: string; remaining: number; total: number }) => {
      if (active && (state.total > 0 || state.phase === 'success')) setKnown({ remaining: state.remaining, total: state.total });
    };
    api
      .pickupsState()
      .then(take)
      .catch(() => {});
    const unsubscribe = api.subscribePickups(take);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  return known;
}
