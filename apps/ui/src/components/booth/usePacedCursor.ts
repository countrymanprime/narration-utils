import { useEffect, useState } from 'react';
import { pacedStep } from './readerModel';

const STEP_MS = 45;
// Nobody reads this many words between two reports: it is a session being
// picked up mid-chapter, so show it in place rather than walking there.
const SNAP_WORDS = 80;

const prefersReducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The word the highlight is on. The tracker reports positions in bursts (a
 * confirmed phrase can move it several words at once), so forward movement is
 * walked a few words at a time to read as a smooth follow. It only ever
 * catches up to the real position - it never runs ahead of it (ADR-0015) - and
 * a move backward, or reduced-motion, lands immediately.
 */
export function usePacedCursor(target: number): number {
  const [paced, setPaced] = useState(target);
  const reduced = prefersReducedMotion();
  if (target < paced || target - paced > SNAP_WORDS) setPaced(target);

  useEffect(() => {
    if (paced >= target || reduced) return;
    const timer = setTimeout(() => setPaced((current) => pacedStep(current, target)), STEP_MS);
    return () => clearTimeout(timer);
  }, [paced, target, reduced]);

  return reduced ? target : Math.min(paced, target);
}
