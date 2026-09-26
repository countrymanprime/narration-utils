import { describe, expect, it } from 'vitest';
import { percentInRange, zoneFor, updateHeldPeak, PEAK_HOLD_MS } from './levelMeter';

describe('percentInRange', () => {
  it('is 0% at the floor and 100% at 0 dBFS', () => {
    expect(percentInRange(-60, -60)).toBe(0);
    expect(percentInRange(0, -60)).toBe(100);
  });

  it('is proportional between floor and 0 dBFS', () => {
    expect(percentInRange(-30, -60)).toBe(50);
  });

  it('clamps below the floor to 0% and above 0 dBFS to 100%', () => {
    expect(percentInRange(-100, -60)).toBe(0);
    expect(percentInRange(6, -60)).toBe(100);
  });

  it('honours a custom floor', () => {
    expect(percentInRange(-20, -40)).toBe(50);
  });
});

describe('zoneFor', () => {
  it('is "body" well below the ceiling', () => {
    expect(zoneFor(-24, -3)).toBe('body');
  });

  it('is "hot" within the margin below the ceiling', () => {
    expect(zoneFor(-6, -3)).toBe('hot');
  });

  it('is "over" at or above the ceiling', () => {
    expect(zoneFor(-3, -3)).toBe('over');
    expect(zoneFor(0, -3)).toBe('over');
  });

  it('honours a custom ceiling', () => {
    expect(zoneFor(-6, -6)).toBe('over');
    expect(zoneFor(-8, -6)).toBe('hot');
    expect(zoneFor(-24, -6)).toBe('body');
  });
});

describe('updateHeldPeak', () => {
  it('adopts a higher incoming reading immediately', () => {
    const held = updateHeldPeak({ peak: -40, at: 0 }, -10, 100);
    expect(held).toEqual({ peak: -10, at: 100 });
  });

  it('holds a lower incoming reading until the hold window elapses', () => {
    const afterLoud = { peak: -6, at: 1000 };
    const stillHeld = updateHeldPeak(afterLoud, -40, 1000 + PEAK_HOLD_MS - 1);
    expect(stillHeld).toEqual({ peak: -6, at: 1000 });
  });

  it('lets a lower reading through once the hold window elapses', () => {
    const afterLoud = { peak: -6, at: 1000 };
    const released = updateHeldPeak(afterLoud, -40, 1000 + PEAK_HOLD_MS + 1);
    expect(released).toEqual({ peak: -40, at: 1000 + PEAK_HOLD_MS + 1 });
  });
});
