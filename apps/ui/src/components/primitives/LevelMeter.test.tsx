// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LevelMeter } from './LevelMeter';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LevelMeter', () => {
  it('is a real, named meter reading "silent" with no reading yet', () => {
    render(<LevelMeter label="Input level" peak={null} rms={null} />);
    const meter = screen.getByRole('meter', { name: 'Input level' });
    expect(meter.getAttribute('aria-valuetext')).toBe('silent');
    expect(meter.getAttribute('aria-valuenow')).toBe('-60');
  });

  it('reports its dBFS value once the throttle window lets it through', () => {
    vi.useFakeTimers();
    render(<LevelMeter label="Input level" peak={-6} rms={-18} />);
    const meter = screen.getByRole('meter', { name: 'Input level' });
    // The first value is never delayed.
    expect(meter.getAttribute('aria-valuetext')).toBe('-18 dBFS');
  });

  it('is decorative (aria-hidden, no accessible name) when asked', () => {
    render(<LevelMeter label="Input level" peak={-6} rms={-18} decorative />);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('honours a custom floor and ceiling for its accessible range', () => {
    render(<LevelMeter label="Room level" peak={null} rms={-70} floor={-80} ceiling={-10} />);
    const meter = screen.getByRole('meter', { name: 'Room level' });
    expect(meter.getAttribute('aria-valuemin')).toBe('-80');
    expect(meter.getAttribute('aria-valuenow')).toBe('-70');
  });

  it('shows no peak tick when no peak reading is given', () => {
    const { container } = render(<LevelMeter label="Input level" peak={null} rms={-20} />);
    expect(container.querySelector('[data-peak-tick]')).toBeNull();
  });

  it('shows a peak tick when a peak reading is given', () => {
    const { container } = render(<LevelMeter label="Input level" peak={-6} rms={-20} />);
    expect(container.querySelector('[data-peak-tick]')).not.toBeNull();
  });
});
