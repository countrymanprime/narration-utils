// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

afterEach(() => vi.unstubAllGlobals());

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    set(next: boolean) {
      media.matches = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

describe('useMediaQuery', () => {
  it('answers the fallback where there is no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useMediaQuery('(min-width: 48rem)', true)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery('(min-width: 48rem)', false)).result.current).toBe(false);
  });

  it('follows the query as it changes, and stops listening on unmount', () => {
    const media = stubMatchMedia(true);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 48rem)', false));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
