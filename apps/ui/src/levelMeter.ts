/**
 * Shared dBFS math for `LevelMeter` (the primitive) and `useInputLevel` (the teleprompter's live level hook):
 * the dBFS-to-percent width map, which zone a reading falls in relative to the peak ceiling, and the peak-hold
 * ballistics (studio-ui-primitives.prd.md Phase 5, ADR 0360 Q2).
 */

export type LevelMeterZone = 'body' | 'hot' | 'over';

// How close to the ceiling a reading must get before it reads as the "hot" warning zone rather than the safe body
// zone: a fixed margin below whatever ceiling the caller passes (Q2's props-with-ACX-defaults choice), so a stricter
// or looser platform's ceiling still gets a warning band instead of the whole safe range reading "hot" for the last
// inch.
const HOT_MARGIN_DB = 6;

/** `dbfs` as a 0-100% width between `floor` (0%) and 0 dBFS, digital full scale (100%), clamped at both ends. */
export function percentInRange(dbfs: number, floor: number): number {
  return Math.round(Math.min(100, Math.max(0, ((dbfs - floor) / -floor) * 100)));
}

/** Which zone a reading falls in relative to `ceiling`: `over` at or above it, `hot` within `HOT_MARGIN_DB` below it, `body` otherwise. */
export function zoneFor(dbfs: number, ceiling: number): LevelMeterZone {
  if (dbfs >= ceiling) return 'over';
  if (dbfs >= ceiling - HOT_MARGIN_DB) return 'hot';
  return 'body';
}

// How long a peak marker is held before it may fall to a lower reading (a classic meter's peak-hold ballistics): a
// still meter between words should not visibly crawl down on every quiet chunk.
export const PEAK_HOLD_MS = 1500;

export type HeldPeak = { peak: number; at: number };

/** The next held-peak state given an incoming reading at `now`: holds the higher of the two until `PEAK_HOLD_MS` has passed. */
export function updateHeldPeak(previous: HeldPeak, incoming: number, now: number): HeldPeak {
  const peak = incoming >= previous.peak || now - previous.at > PEAK_HOLD_MS ? incoming : previous.peak;
  return { peak, at: peak === incoming ? now : previous.at };
}
