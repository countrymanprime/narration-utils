import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { PickupsState } from '../../types';

const IDLE: PickupsState = { phase: 'idle', message: '', remaining: 0, total: 0, csv: '' };

/**
 * The proofer's pickup list as REAPER last reported it (stage-navigation-and-page-replacement.prd.md Phase 7): the live
 * pickups event, the run already in flight, then a fresh count. The Pickups page and the Booth companion's Pickups
 * section both read it, so they never disagree about what is left.
 */
export function usePickupsState(): PickupsState {
  const api = useApi();
  const [state, setState] = useState<PickupsState>(IDLE);

  useEffect(() => {
    const unsubscribe = api.subscribePickups(setState);
    // Hydrates whatever run was already in flight, then asks for a fresh count so a narrator sees where things stand
    // without an extra press (the "remaining count" the phase's success signal names). Count only after the hydrate
    // settles, not in a second, independent effect: two unordered fetches racing on the same `setState` can resolve out
    // of order and flash the page back to a stale phase after Count has already moved it on.
    void api
      .pickupsState()
      .then((fetched) => {
        setState(fetched);
        return api.pickupsCount();
      })
      .catch(() => {});
    return unsubscribe;
  }, [api]);

  return state;
}
