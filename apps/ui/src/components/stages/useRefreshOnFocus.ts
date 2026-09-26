import { useEffect, useRef } from 'react';

const THROTTLE_MS = 30_000;

/**
 * Re-reads stage suggestions and the chapter list when the window regains focus or the page becomes visible again
 * (home-stage-check-line.prd.md Phase 2, Q2 A): every other evidence change is already read on its own (import,
 * a finished check, a status changed by hand), so the one gap this closes is the narrator saving the project in
 * REAPER, or a recording check result changing, while Home stays open. Throttled to once per THROTTLE_MS so
 * switching apps repeatedly does not re-read every time, and skipped while `busy` (a Confirm, Dismiss or Revert in
 * flight): `refresh()` already drops stale answers by request number, but a focus read has nothing to add while a
 * write is pending and would only cost a round trip.
 */
export function useRefreshOnFocus(onFocus: () => void, busy: boolean): void {
  const last = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  useEffect(() => {
    const trigger = () => {
      if (busyRef.current) return;
      const now = Date.now();
      if (now - last.current < THROTTLE_MS) return;
      last.current = now;
      onFocusRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') trigger();
    };
    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
