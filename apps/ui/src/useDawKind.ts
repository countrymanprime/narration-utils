import { useEffect, useState } from 'react';
import { useApi } from './api/ApiContext';
import type { DawKind } from './api/contracts/daw';

/**
 * Which DAW backs this session (`dawCapabilities().daw`, DAW port PRD Phase 4): read once and kept current by
 * `daw_capabilities_changed`, the same read-then-subscribe race handling as `useCapability`. Undefined until the
 * first answer, so a caller that must act before then keeps today's REAPER-shaped behaviour rather than guessing.
 */
export function useDawKind(): DawKind | undefined {
  const api = useApi();
  const [daw, setDaw] = useState<DawKind>();

  useEffect(() => {
    let receivedEvent = false;
    const unsubscribe = api.subscribeDawCapabilities((next) => {
      receivedEvent = true;
      setDaw(next.daw);
    });
    void api
      .dawCapabilities()
      .then((next) => {
        if (!receivedEvent) setDaw(next.daw);
      })
      // A failed seed leaves the kind unknown until the next real daw_capabilities_changed event (SILENT_CATCHES).
      .catch(() => undefined);
    return unsubscribe;
  }, [api]);

  return daw;
}
