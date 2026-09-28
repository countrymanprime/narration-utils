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

  it('defaults to the 16 px accent bar on --surface-3', () => {
    const { container } = render(<ProgressBar label="Working" value={40} />);
    const track = container.querySelector('.progressbar') as HTMLElement;
    expect(track.className).toContain('h-4');
    expect(track.className).toContain('bg-[var(--surface-3)]');
    expect((track.firstElementChild as HTMLElement).className).toContain('bg-[var(--accent)]');
  });

  it('draws the thin 8 px bar on --surface-2 when asked, tinted by tone', () => {
    const { container } = render(<ProgressBar label="Finished audio" value={40} size="thin" tone="ok" />);
    const track = container.querySelector('.progressbar') as HTMLElement;
    expect(track.className).toContain('h-2');
    expect(track.className).toContain('bg-[var(--surface-2)]');
    expect((track.firstElementChild as HTMLElement).className).toContain('bg-[var(--ok)]');
  });

  it('tints the fill warn when asked', () => {
    const { container } = render(<ProgressBar label="Voice rest" value={38} tone="warn" />);
    expect((container.querySelector('.progressbar > div') as HTMLElement).className).toContain('bg-[var(--warn)]');
  });
});
