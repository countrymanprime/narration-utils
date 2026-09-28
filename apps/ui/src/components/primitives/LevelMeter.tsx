import { useEffect, useRef, useState } from 'react';
import { percentInRange, zoneFor, zoneBoundaries, type LevelMeterZone } from '../../levelMeter';

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

// The LED-ladder segment pitch per size (mock-fidelity-primitives-and-components.prd.md Phase 9, mock B03: "231 x 10 px,
// segmented ok/warn/danger"). The mock gives the bar's own size, not a segment count, since a bar's width is the
// caller's; these keep segments roughly square at each height, scaling with it.
const SIZE_SEGMENT: Record<'compact' | 'regular' | 'booth', { segment: number; gap: number }> = {
  compact: { segment: 3, gap: 1 },
  regular: { segment: 4, gap: 2 },
  booth: { segment: 5, gap: 2 },
};

function segmentMask(size: keyof typeof SIZE_SEGMENT): string {
  const { segment, gap } = SIZE_SEGMENT[size];
  return `repeating-linear-gradient(to right, #000 0, #000 ${segment}px, transparent ${segment}px, transparent ${segment + gap}px)`;
}

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
  // A classic LED ladder, not one flat colour for the current reading: every position across the bar is graded
  // body/hot/over by where it sits between floor and ceiling (mock B03), and the reading only says how much of that
  // fixed gradient is lit. The mask (fill and cover together, never the peak tick) cuts the continuous gradient into
  // discrete segments.
  const { hotStart, overStart } = zoneBoundaries(floor, ceiling);
  const gradient = `linear-gradient(to right, ${ZONE_TOKEN.body} 0%, ${ZONE_TOKEN.body} ${hotStart}%, ${ZONE_TOKEN.hot} ${hotStart}%, ${ZONE_TOKEN.hot} ${overStart}%, ${ZONE_TOKEN.over} ${overStart}%, ${ZONE_TOKEN.over} 100%)`;
  const mask = segmentMask(size);
  return (
    <div {...control} className={`relative overflow-hidden rounded-full ${SIZE_HEIGHT[size]} ${className}`} style={{ background: 'var(--meter-floor)' }}>
      <div className="absolute inset-0" style={{ maskImage: mask, WebkitMaskImage: mask }}>
        <div className="absolute inset-0" style={{ background: gradient }} />
        <div
          className="absolute inset-y-0 right-0 motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out"
          style={{ width: `${100 - width}%`, background: 'var(--meter-floor)' }}
        />
      </div>
      {peak !== null && (
        <span
          data-peak-tick
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 motion-safe:transition-[left] motion-safe:duration-150 motion-safe:ease-out"
          style={{ left: `${percentInRange(peak, floor)}%`, background: ZONE_TOKEN[zoneFor(peak, ceiling)] }}
        />
      )}
    </div>
  );
}
