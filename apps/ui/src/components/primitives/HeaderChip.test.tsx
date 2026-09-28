// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderChip } from './HeaderChip';

afterEach(cleanup);

describe('HeaderChip', () => {
  // jsdom lays nothing out, so the measured spec (ADR 0635) is pinned by its classes here and measured by the atlas story.
  it('is the 22 px round chip with no border, in the label’s own case', () => {
    render(<HeaderChip>Book 1 · Wonderland series</HeaderChip>);
    const chip = screen.getByText('Book 1 · Wonderland series');
    expect(chip.className).toContain('h-[1.375rem]');
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).toContain('px-[0.625rem]');
    expect(chip.className).not.toMatch(/\bborder\b/);
    expect(chip.className).not.toContain('uppercase');
  });

  it('fills each tone with the mock’s pair', () => {
    render(
      <>
        <HeaderChip>neutral</HeaderChip>
        <HeaderChip tone="success">success</HeaderChip>
        <HeaderChip tone="warning">warning</HeaderChip>
      </>,
    );
    expect(screen.getByText('neutral').style.background).toBe('var(--surface-2)');
    expect(screen.getByText('neutral').style.color).toBe('var(--text)');
    expect(screen.getByText('success').style.background).toBe('var(--ok-soft)');
    expect(screen.getByText('success').style.color).toBe('var(--ok-text)');
    expect(screen.getByText('warning').style.background).toBe('var(--warn-soft)');
  });

  it('draws a decorative dot before its content', () => {
    render(<HeaderChip dot="var(--ok)">REAPER linked</HeaderChip>);
    const dot = screen.getByText('REAPER linked').firstElementChild as HTMLElement;
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.style.background).toBe('var(--ok)');
  });

  it('is a button when it opens something, and marks a running action busy', () => {
    const onClick = vi.fn();
    render(
      <HeaderChip onClick={onClick} aria-busy aria-label="REAPER linked — open the engine panel">
        REAPER linked
      </HeaderChip>,
    );
    const button = screen.getByRole('button', { name: 'REAPER linked — open the engine panel' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('names a chip that is not a button through its role', () => {
    render(
      <HeaderChip role="timer" aria-label="Timer running: 0:00:05">
        0:00:05
      </HeaderChip>,
    );
    expect(screen.getByRole('timer', { name: 'Timer running: 0:00:05' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
