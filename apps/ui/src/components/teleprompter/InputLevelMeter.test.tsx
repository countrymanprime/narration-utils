// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputLevelMeter } from './InputLevelMeter';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InputLevelMeter', () => {
  it('is a real, named meter reading "silent" with no level yet', () => {
    render(<InputLevelMeter level={null} />);
    const meter = screen.getByRole('meter', { name: 'Input level' });
    expect(meter.getAttribute('aria-valuetext')).toBe('silent');
    expect(meter.getAttribute('aria-valuenow')).toBe('-100');
  });

  it('reports its dBFS value once the throttle window lets it through', () => {
    vi.useFakeTimers();
    render(<InputLevelMeter level={{ peak: -6, rms: -18 }} />);
    const meter = screen.getByRole('meter', { name: 'Input level' });
    // The first value is never delayed.
    expect(meter.getAttribute('aria-valuetext')).toBe('-18 dBFS');
  });

  it('is decorative (aria-hidden, no accessible name) inside the bar button', () => {
    render(<InputLevelMeter level={{ peak: -6, rms: -18 }} decorative />);
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
