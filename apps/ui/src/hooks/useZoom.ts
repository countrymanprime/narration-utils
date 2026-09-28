import { useCallback, useEffect, useRef, useState } from 'react';
import type { SystemApi } from '../api/contracts/system';
import { useDebouncedValue } from './useDebouncedValue';

// Mirrors apps/desktop/bindings_window.go's zoomSteps (Q6 A, ADR 0201): the header's buttons and Ctrl+=/-/0 step
// through these six levels; the host snaps and clamps to the same list defensively, so a value this file computes
// from it is never rejected.
const ZOOM_STEPS = [1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const ANNOUNCE_DEBOUNCE_MS = 500;

/** The step in ZOOM_STEPS closest to level; a level outside the list (only reachable by Ctrl+wheel/pinch below 100%,
 * ADR 0201 item 2) reads as its nearest end. */
function nearestStepIndex(level: number): number {
  let nearest = 0;
  for (let index = 1; index < ZOOM_STEPS.length; index++) {
    if (Math.abs(ZOOM_STEPS[index] - level) < Math.abs(ZOOM_STEPS[nearest] - level)) nearest = index;
  }
  return nearest;
}

/**
 * The header's zoom group (app-navigation-and-zoom-controls.prd.md Phase 2, D29): reads and sets the window's real
 * webview zoom through the `windowZoom`/`windowSetZoom` binding. `zoomIn`/`zoomOut` step through Q6/ADR 0201's six
 * levels from the current one's nearest step; `reset` always sets 100%, from any level.
 *
 * Ctrl+wheel and pinch move the level outside this hook entirely (they are WebView2's own, ADR 0201), so the only
 * signal that one of them changed anything is the `resize` a zoom change fires (it changes the CSS viewport); Wails
 * v3 surfaces no zoom-changed event on Windows (Technical Approach). A level found above the 200% ceiling that way is
 * set back to it; one under 100% is only shown, per ADR 0201 item 2 ("kept, because a smaller page cramps nothing").
 *
 * `announcement` is the debounced, polite text a run of wheel notches or clicks should announce once, at the level
 * the narrator settles on ("Solution Detail": "not on every wheel notch").
 *
 * The settled level is also persisted (app-navigation-and-zoom-controls.prd.md Phase 3, Q4 A): `windowSaveZoom`,
 * debounced by the same settle, so a run of wheel notches or clicks writes once, not on every step. The mount read's
 * own value is skipped, the same way it is never announced - it is already what is on disk (or what a fresh install
 * has never set), so saving it back would be a no-op write on every launch.
 */
export function useZoom(api: Pick<SystemApi, 'windowZoom' | 'windowSetZoom' | 'windowSaveZoom'>) {
  const [level, setLevel] = useState(1.0);
  const debouncedLevel = useDebouncedValue(level, ANNOUNCE_DEBOUNCE_MS);
  const [announcement, setAnnouncement] = useState('');
  // The level already announced (and the mount read's own value, which must not announce itself).
  const announcedRef = useRef(1.0);
  // The level already saved (and the mount read's own value, which must not be written straight back).
  const savedRef = useRef(1.0);

  useEffect(() => {
    void api
      .windowZoom()
      .then((result) => {
        announcedRef.current = result.level;
        savedRef.current = result.level;
        setLevel(result.level);
      })
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (debouncedLevel === announcedRef.current) return;
    announcedRef.current = debouncedLevel;
    setAnnouncement(`Zoom ${Math.round(debouncedLevel * 100)}%`);
  }, [debouncedLevel]);

  useEffect(() => {
    if (debouncedLevel === savedRef.current) return;
    savedRef.current = debouncedLevel;
    void api.windowSaveZoom(debouncedLevel).catch(() => undefined);
  }, [debouncedLevel, api]);

  // Returns its promise (rather than firing and forgetting) so a caller - a button's onClick, or a test - can await
  // the level actually landing; nothing here throws, since a failed call has nowhere to go but staying at the old level.
  const apply = useCallback(
    (factor: number) =>
      api
        .windowSetZoom(factor)
        .then((result) => setLevel(result.level))
        .catch(() => undefined),
    [api],
  );

  const refresh = useCallback(
    () =>
      api
        .windowZoom()
        .then((result) => {
          // ADR 0201 item 2: a level above the ceiling (Ctrl+wheel/pinch) is set back to it; under the floor is kept.
          if (result.level > ZOOM_MAX) return apply(ZOOM_MAX);
          setLevel(result.level);
          return undefined;
        })
        .catch(() => undefined),
    [api, apply],
  );

  useEffect(() => {
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, [refresh]);

  const index = nearestStepIndex(level);
  return {
    level,
    percent: Math.round(level * 100),
    canZoomOut: index > 0,
    canZoomIn: index < ZOOM_STEPS.length - 1,
    zoomIn: () => apply(ZOOM_STEPS[Math.min(index + 1, ZOOM_STEPS.length - 1)]),
    zoomOut: () => apply(ZOOM_STEPS[Math.max(index - 1, 0)]),
    reset: () => apply(ZOOM_MIN),
    /** Debounced, polite "Zoom N%"; empty until the first real change. */
    announcement,
  };
}
