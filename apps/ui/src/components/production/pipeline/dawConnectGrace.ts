import { useEffect, useState } from 'react';

/** When this window's code loaded: the app connects to the DAW right after it opens, so the first seconds are "connecting", not "failed". */
export const APP_STARTED_AT = Date.now();

/** How long after the app opens a DAW that is not connected yet is shown as connecting before it is shown as not running. */
export const DAW_CONNECT_GRACE_MS = 10_000;

/**
 * True until `graceMs` after `startedAt`, then false for good: the page draws a quiet "Connecting…" instead of the not-running
 * banner while the host finds and attaches the DAW's bridge, and the banner only if the connection did not come in time.
 */
export function useConnectGrace(graceMs: number, startedAt: number = APP_STARTED_AT): boolean {
  const [left, setLeft] = useState(() => Math.max(0, startedAt + graceMs - Date.now()));
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft(0), left);
    return () => clearTimeout(timer);
  }, [left]);
  return left > 0;
}
