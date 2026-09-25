import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

// React Router's `createBrowserHistory` (the `history` package) writes `{ idx, key, usr }` into
// `window.history.state` on every push, replace and pop; `idx` is the cheapest way to know where we are
// in the in-app history without the Navigation API (not consistently available across the engines the
// browser demo runs in). Falls back to 0 for the very first entry, before any push has happened.
function currentIdx(): number {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

/**
 * Page-level Back/Forward for the app (app-navigation-and-zoom-controls.prd.md Phase 1, Q5, Q8). Tracks only
 * in-app page moves through React Router's history `idx`:
 * - a **push** (a nav click, a "go to" link) discards any forward entries and becomes the new ceiling;
 * - a **replace** (a redirect, an anchor settling) does not move the ceiling;
 * - a **pop** (our own guarded back/forward, or a browser/mouse gesture the guard could not stop) never
 *   moves the ceiling, only the current position.
 *
 * `resetFloor()` is called once a project attaches (Q8): entries from an earlier project stay behind the
 * floor and Back stops there, because they would open that project's pages with this project's data.
 *
 * `back()`/`forward()` here are the raw moves (`navigate(-1)`/`navigate(1)`); the guards that Back and
 * Forward must run (unsaved Settings, leaving Proofing) live in `App.tsx`, which wraps these before calling
 * them, the way `guardedNavigate` wraps a path move. `unexpectedPop` covers the case a browser or mouse
 * gesture moves history without going through that wrapper (Phase 0 tells us whether WebView2 needs it):
 * `App.tsx` checks the same guards when it sees one and calls `clearUnexpectedPop()` once it has.
 */
export function useAppHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [idx, setIdx] = useState(currentIdx);
  const [floor, setFloor] = useState(0);
  const [unexpectedPop, setUnexpectedPop] = useState(false);
  const ceilingRef = useRef(idx);
  // True only while a pop this hook itself started (via back()/forward()) is in flight, so an unrelated pop
  // (a mouse-button gesture WebView2 acted on despite preventDefault, or another popstate the app did not
  // start) can be told apart from ours.
  const ownPopRef = useRef(false);
  // React Router reports the very first location as a 'POP' (there is nothing to have popped from), so the
  // first effect run must not be read as an unrelated pop.
  const mountedRef = useRef(false);

  useEffect(() => {
    const next = currentIdx();
    setIdx(next);
    if (navigationType === 'PUSH') ceilingRef.current = next;
    else if (next > ceilingRef.current) ceilingRef.current = next;
    if (navigationType === 'POP' && mountedRef.current) {
      if (!ownPopRef.current) setUnexpectedPop(true);
      ownPopRef.current = false;
    }
    mountedRef.current = true;
  }, [location.key, navigationType]);

  const resetFloor = useCallback(() => setFloor(currentIdx()), []);
  const clearUnexpectedPop = useCallback(() => setUnexpectedPop(false), []);

  const back = useCallback(() => {
    ownPopRef.current = true;
    navigate(-1);
  }, [navigate]);

  const forward = useCallback(() => {
    ownPopRef.current = true;
    navigate(1);
  }, [navigate]);

  return {
    canGoBack: idx > floor,
    canGoForward: idx < ceilingRef.current,
    back,
    forward,
    resetFloor,
    /** True once a `popstate` moved history without going through this hook's own `back()`/`forward()`. */
    unexpectedPop,
    clearUnexpectedPop,
  };
}
