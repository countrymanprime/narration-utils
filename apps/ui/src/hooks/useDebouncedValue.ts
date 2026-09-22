import { useEffect, useState } from 'react';

// The manuscript search debounce (R1): line results wait this long after the last keystroke
// before firing, so typing a name doesn't fire a request per letter. Enter bypasses it
// (Manuscript.tsx calls the search directly); the chapter-title/subtitle subset (R2) is client-side
// and never debounced, so a narrator sees something moving immediately.
export const SEARCH_DEBOUNCE_MS = 2_000;

// Returns `value`, but only after it has stopped changing for `ms` - the standard debounce
// pattern, generic so any future debounced input can reuse it. A change mid-wait restarts the
// timer; unmounting (or `ms`/`value` changing again) clears the pending one, so a stale update
// can never land after the caller has moved on.
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
