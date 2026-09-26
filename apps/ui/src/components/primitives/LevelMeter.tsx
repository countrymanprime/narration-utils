import { useEffect, useRef, useState } from 'react';
import { percentInRange, zoneFor, type LevelMeterZone } from '../../levelMeter';

// How often the accessible value is allowed to change (as InputLevelMeter did): the visual bar itself redraws on
// every event (about every 100 ms), but a screen reader hearing an `aria-valuetext` that often would be flooded.
const ANNOUNCE_MS = 1000;

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

const ZONE_TOKEN: Record<LevelMeterZone, string> = {
  body: 'var(--meter-body)',
  hot: 'var(--meter-hot)',
  over: 'var(--meter-over)',
};

const SIZE_HEIGHT: Record<'compact' | 'regular' | 'booth', string> = {
  compact: 'h-1.5',
  regular: 'h-2.5',
  booth: 'h-4',
};

/**
 * A peak/RMS audio level meter with safe, hot and clipped zones (studio-ui-primitives.prd.md Phase 5, ADR 0360 Q2),
 * replacing the teleprompter-local `InputLevelMeter`. `floor` and `ceiling` default to ACX's noise floor and peak
 * ceiling but are props, since Q2 leaves both "to verify" and other delivery platforms may differ. The RMS fill's
 * colour and the peak-hold tick's position both move through the zones from `src/levelMeter.ts`, shared with
 * `useInputLevel`'s peak-hold ballistics. `role="meter"` with `aria-valuetext` throttled to once a second, as
 * `InputLevelMeter` did; the fill and tick's transitions are `motion-safe` only.
 */
export function LevelMeter({
  label,
  peak,
  rms,
  floor = -60,
  ceiling = -3,
  size = 'regular',
  decorative = false,
  className = '',
}: {
  label: string;
  peak: number | null;
  rms: number | null;
  floor?: number;
  ceiling?: number;
  size?: 'compact' | 'regular' | 'booth';
  decorative?: boolean;
  className?: string;
}) {
  const announced = useThrottled(rms, ANNOUNCE_MS);
  const rmsValue = rms ?? floor;
  const width = percentInRange(rmsValue, floor);
  const zone = zoneFor(rmsValue, ceiling);
  const valueText = announced !== null ? `${Math.round(announced)} dBFS` : 'silent';
  const control = decorative
    ? { 'aria-hidden': true as const }
    : {
        role: 'meter' as const,
        'aria-label': label,
        'aria-valuemin': floor,
        'aria-valuemax': 0,
        'aria-valuenow': announced !== null ? Math.round(announced) : floor,
        'aria-valuetext': valueText,
      };
  return (
    <div {...control} className={`relative overflow-hidden rounded-full ${SIZE_HEIGHT[size]} ${className}`} style={{ background: 'var(--meter-floor)' }}>
      <span
        className="block h-full motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out"
        style={{ width: `${width}%`, background: ZONE_TOKEN[zone] }}
      />
      {peak !== null && (
        <span
          data-peak-tick
          aria-hidden="true"
          className="absolute inset-y-0 w-px motion-safe:transition-[left] motion-safe:duration-150 motion-safe:ease-out"
          style={{ left: `${percentInRange(peak, floor)}%`, background: ZONE_TOKEN[zoneFor(peak, ceiling)] }}
        />
      )}
    </div>
  );
}
