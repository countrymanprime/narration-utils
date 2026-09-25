// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRefreshOnFocus } from './useRefreshOnFocus';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useRefreshOnFocus', () => {
  it('reads once when the window regains focus, and again only after the throttle passes', () => {
    const onFocus = vi.fn();
    renderHook(() => useRefreshOnFocus(onFocus, false));

    act(() => window.dispatchEvent(new Event('focus')));
    expect(onFocus).toHaveBeenCalledTimes(1);

    // A second focus inside the throttle window reads nothing new.
    act(() => window.dispatchEvent(new Event('focus')));
    expect(onFocus).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(30_000));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it('also reads when the page becomes visible again, sharing the same throttle as focus', () => {
    const onFocus = vi.fn();
    renderHook(() => useRefreshOnFocus(onFocus, false));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(onFocus).toHaveBeenCalledTimes(1);

    act(() => window.dispatchEvent(new Event('focus')));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('skips the read while a decision is pending', () => {
    const onFocus = vi.fn();
    const { rerender } = renderHook(({ busy }) => useRefreshOnFocus(onFocus, busy), { initialProps: { busy: true } });

    act(() => window.dispatchEvent(new Event('focus')));
    expect(onFocus).not.toHaveBeenCalled();

    rerender({ busy: false });
    act(() => window.dispatchEvent(new Event('focus')));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
