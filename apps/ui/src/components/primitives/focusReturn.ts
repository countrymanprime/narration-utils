import { useEffect, useRef } from 'react';

// Where focus goes when a panel that stays mounted (a drawer, opened and closed through `open`) closes: the element that had
// focus when it opened, or, when that element is gone (the click removed it, or the layout changed), into the page's <main>
// (its first control, or <main> itself, which AppShell makes focusable). Base UI would otherwise drop focus on <body>.
// `Dialog` mounts fresh each time and captures its opener when it mounts, so it has its own copy of the same rule.
export function useReturnFocusTarget(open: boolean): () => HTMLElement | boolean {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Runs right after the panel opens, before the library moves focus into it (it does that a frame later).
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return () => {
    const element = opener.current;
    if (element?.isConnected && element !== document.body) return element;
    return document.querySelector<HTMLElement>('main') ?? true;
  };
}
