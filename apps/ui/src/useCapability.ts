import { useEffect, useState } from 'react';
import { useApi } from './api/ApiContext';
import type { DawCapabilityKey } from './api/contracts/daw';
import type { CapabilityEntry } from './components/primitives/CapabilityGate';

const UNKNOWN_CAPABILITY: CapabilityEntry = { level: 'unsupported', available: false };

/**
 * One capability's live entry from the DAW port's capability report (studio-ui-primitives.prd.md Phase 12): read once
 * with `dawCapabilities()`, then kept current by `daw_capabilities_changed`, the same read-then-subscribe race
 * handling as `useChapterSync` (an update the subscription's own attach triggers may resolve before the plain read
 * does, so a stale read is dropped rather than allowed to overwrite it). A capability the host's report does not
 * carry - one this build's `DawCapabilityKey` union does not yet know, or a future one an older host never sends -
 * answers `unsupported`/unavailable rather than throwing, since `CapabilityGate` needs an entry for every control it
 * wraps whether or not the host has heard of it yet.
 */
export function useCapability(capability: DawCapabilityKey): CapabilityEntry {
  const api = useApi();
  const [entry, setEntry] = useState<CapabilityEntry>(UNKNOWN_CAPABILITY);

  useEffect(() => {
    let receivedEvent = false;
    const unsubscribe = api.subscribeDawCapabilities((next) => {
      receivedEvent = true;
      setEntry(next.capabilities[capability] ?? UNKNOWN_CAPABILITY);
    });
    void api
      .dawCapabilities()
      .then((next) => {
        if (!receivedEvent) setEntry(next.capabilities[capability] ?? UNKNOWN_CAPABILITY);
      })
      // A failed seed leaves the entry unsupported/unavailable until the next real daw_capabilities_changed event (SILENT_CATCHES).
      .catch(() => undefined);
    return unsubscribe;
  }, [api, capability]);

  return entry;
}
