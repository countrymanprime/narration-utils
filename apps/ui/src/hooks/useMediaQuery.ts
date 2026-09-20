import { useCallback, useSyncExternalStore } from 'react';

// Whether a CSS media query matches, kept current as the window resizes. `fallback` is the answer where there is no
// `matchMedia` (jsdom, a test). The app renders only on the client, so there is no server snapshot.
export function useMediaQuery(query: string, fallback: boolean): boolean {
  // Stable per query, so React subscribes once and not on every render.
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback));
}
