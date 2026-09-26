import { useEffect, useRef, useState } from 'react';
import type { InputLevel } from './useInputLevel';

// Below this, the bar reads as empty (a still, near-silent microphone); above 0 dBFS is full scale (clipping).
const FLOOR_DBFS = -60;
// How often the accessible value is allowed to change (Bar anatomy, read-aloud-control-bar.prd.md): the visual bar
// itself redraws on every event (about every 100 ms), but a screen reader hearing an `aria-valuetext` that often
// would be flooded.
const ANNOUNCE_MS = 1000;

const percent = (dbfs: number): number => Math.round(Math.min(100, Math.max(0, ((dbfs - FLOOR_DBFS) / -FLOOR_DBFS) * 100)));

/** `value`, throttled to change at most once every `ms` (the first value is never delayed). */
function useThrottled<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastAt = useRef(0);
  useEffect(() => {
    const elapsed = Date.now() - lastAt.current;
    if (elapsed >= ms) {
      lastAt.current = Date.now();
      setThrottled(value);
      return;
    }
    const timer = setTimeout(() => {
      lastAt.current = Date.now();
      setThrottled(value);
    }, ms - elapsed);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return throttled;
}

/**
 * The live input-level meter (read-aloud-control-bar.prd.md Phase 4, ADR 0247): a horizontal bar whose fill tracks the
 * RMS in dBFS. Two sizes share this component: a small one drawn inside the bar's microphone button, decorative only
 * (`aria-hidden`, since the button's own name already says which device is chosen - Bar anatomy); and a larger one in
 * the microphone popover, the real `role="meter"` control named "Input level" with its value throttled so a screen
 * reader is not flooded by roughly ten events a second. The fill's width transition is `motion-safe`, so reduced
 * motion shows the new level at once with no animated rise or fall (the same convention as `MeterBar`).
 */
export function InputLevelMeter({ level, decorative = false, className = '' }: { level: InputLevel | null; decorative?: boolean; className?: string }) {
  const rms = level?.rms ?? -100;
  const width = percent(rms);
  const announced = useThrottled(level, ANNOUNCE_MS);
  const valueText = announced ? `${Math.round(announced.rms)} dBFS` : 'silent';
  const control = decorative
    ? { 'aria-hidden': true as const }
    : {
        role: 'meter' as const,
        'aria-label': 'Input level',
        'aria-valuemin': -100,
        'aria-valuemax': 0,
        'aria-valuenow': announced ? Math.round(announced.rms) : -100,
        'aria-valuetext': valueText,
      };
  return (
    <div {...control} className={`h-1.5 overflow-hidden rounded-full ${className}`} style={{ background: 'var(--surface-3)' }}>
      <span
        className="block h-full motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out"
        style={{ width: `${width}%`, background: 'var(--accent)' }}
      />
    </div>
  );
}
