// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('holds the initial value until the delay elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 1_000), { initialProps: { value: 'a' } });
    expect(result.current).toBe('a');

    rerender({ value: 'ab' });
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('ab');
  });

  it('restarts the wait on every change, so only the settled value ever comes through', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 1_000), { initialProps: { value: 'a' } });

    rerender({ value: 'al' });
    act(() => vi.advanceTimersByTime(600));
    rerender({ value: 'ali' });
    act(() => vi.advanceTimersByTime(600));
    expect(result.current).toBe('a');

    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe('ali');
  });

  it('clears its pending timer on unmount, never firing after the caller has moved on', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    const { unmount } = renderHook(() => useDebouncedValue('a', 1_000));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('SEARCH_DEBOUNCE_MS is 2 seconds, so line results never appear before the requested "about 2s" (R1)', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(2_000);
  });
});
