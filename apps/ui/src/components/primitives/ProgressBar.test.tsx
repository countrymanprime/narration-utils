// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';

afterEach(cleanup);

describe('ProgressBar', () => {
  it('is a progress bar named by its label that announces its value', () => {
    render(<ProgressBar label="Download progress" value={40} />);
    const bar = screen.getByRole('progressbar', { name: 'Download progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('carries the text a screen reader hears instead of the bare number', () => {
    render(<ProgressBar label="Download progress" value={40} valueText="44 of 109 MB" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('44 of 109 MB');
  });

  it('has no value while it is indeterminate, and its fill slides only for people who accept motion', () => {
    const { container } = render(<ProgressBar label="Starting" value={null} running />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
    const fill = container.querySelector('.progressbar > div') as HTMLElement;
    expect(fill.className).toContain('motion-safe:animate-[work-progress-slide_1.15s_ease-in-out_infinite]');
    expect(fill.className.split(/\s+/)).not.toContain('animate-[work-progress-slide_1.15s_ease-in-out_infinite]');
  });

  it('draws a running bar at least a sliver wide, so a job that has begun shows, and a bar that is not running at its value', () => {
    const { container, rerender } = render(<ProgressBar label="Working" value={1} running />);
    expect((container.querySelector('.progressbar > div') as HTMLElement).style.width).toBe('4%');
    rerender(<ProgressBar label="Working" value={0} />);
    expect((container.querySelector('.progressbar > div') as HTMLElement).style.width).toBe('0%');
    rerender(<ProgressBar label="Working" value={72} running />);
    expect((container.querySelector('.progressbar > div') as HTMLElement).style.width).toBe('72%');
  });
});
