// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_INFO_MS, ToastRegion, type ToastMessage } from './Toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const info = (id: number, text = `Message ${id}`): ToastMessage => ({ id, text, tone: 'info' });
const failure = (id: number, text = `Failure ${id}`): ToastMessage => ({ id, text, tone: 'error' });

describe('ToastRegion', () => {
  it('keeps two live regions mounted, so a message that arrives later is announced', () => {
    render(<ToastRegion messages={[]} dismiss={vi.fn()} />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    // A new message is read on its own; without this, each one re-reads every message already showing.
    for (const region of [screen.getByRole('status'), screen.getByRole('alert')]) {
      expect(region.getAttribute('aria-atomic')).toBe('false');
      expect(region.getAttribute('aria-relevant')).toBe('additions');
    }
  });

  it('puts an error in the alert region and everything else in the status region', () => {
    render(<ToastRegion messages={[info(1, 'Saved.'), failure(2, 'Could not save.')]} dismiss={vi.fn()} />);
    expect(within(screen.getByRole('alert')).getByText('Could not save.')).toBeTruthy();
    expect(within(screen.getByRole('status')).getByText('Saved.')).toBeTruthy();
    expect(within(screen.getByRole('status')).queryByText('Could not save.')).toBeNull();
  });

  it('dismisses an information message by itself after its time, and fades it first', () => {
    const dismiss = vi.fn();
    render(<ToastRegion messages={[info(7)]} dismiss={dismiss} />);
    act(() => void vi.advanceTimersByTime(TOAST_INFO_MS - 200));
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByText('Message 7').closest('[data-tone]')?.className).not.toContain('opacity-0');
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByText('Message 7').closest('[data-tone]')?.className).toContain('opacity-0');
    act(() => void vi.advanceTimersByTime(100));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('never dismisses an error by itself, however long it stays', () => {
    const dismiss = vi.fn();
    render(<ToastRegion messages={[failure(3)]} dismiss={dismiss} />);
    act(() => void vi.advanceTimersByTime(TOAST_INFO_MS * 20));
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByText('Failure 3')).toBeTruthy();
  });

  it('dismisses the message whose button was pressed', () => {
    const dismiss = vi.fn();
    render(<ToastRegion messages={[failure(1), failure(2)]} dismiss={dismiss} />);
    fireEvent.click(within(screen.getByText('Failure 2').closest('[data-tone]') as HTMLElement).getByRole('button', { name: 'Dismiss message' }));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('starts a message over when it is replaced by one with a new id, and shows the whole queue at once', () => {
    const dismiss = vi.fn();
    const { rerender } = render(<ToastRegion messages={[info(1, 'Same'), info(2, 'Other')]} dismiss={dismiss} />);
    act(() => void vi.advanceTimersByTime(TOAST_INFO_MS - 500));
    rerender(<ToastRegion messages={[info(2, 'Other'), info(3, 'Same')]} dismiss={dismiss} />);
    act(() => void vi.advanceTimersByTime(600));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getAllByRole('button', { name: 'Dismiss message' })).toHaveLength(2);
  });
});
