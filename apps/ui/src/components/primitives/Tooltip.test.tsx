// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('renders tooltip text in the fixed portal on keyboard focus', () => {
    render(<Tooltip text="Helpful tooltip guidance" />);
    fireEvent.focus(screen.getByText('i'));
    expect(screen.getByRole('tooltip').textContent).toBe('Helpful tooltip guidance');
    expect(screen.getByRole('tooltip').id).toBe('tooltip-layer');
  });

  it('hides the tooltip again on blur', () => {
    render(<Tooltip text="Helpful tooltip guidance" />);
    const trigger = screen.getByText('i');
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('clears the tooltip on unmount instead of leaving it stuck (e.g. a click that navigates away)', () => {
    const { unmount } = render(<Tooltip text="Jump to script in Manuscript" />);
    fireEvent.mouseEnter(screen.getByText('i'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('tooltip').textContent).toBe('Jump to script in Manuscript');

    unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('cancels a pending tooltip when the pointer leaves before one second', () => {
    render(<Tooltip text="Helpful tooltip guidance" />);
    const trigger = screen.getByText('i');
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
