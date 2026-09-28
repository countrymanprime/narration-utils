// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePacedCursor } from './usePacedCursor';

function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
}

// One act per step: React only schedules the next step after it re-renders.
function tick(steps: number) {
  for (let step = 0; step < steps; step += 1) act(() => void vi.advanceTimersByTime(50));
}

beforeEach(() => {
  vi.useFakeTimers();
  preferReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePacedCursor', () => {
  it('starts exactly where the reading already is', () => {
    const { result } = renderHook(() => usePacedCursor(40));

    expect(result.current).toBe(40);
  });

  it('walks forward to a new position instead of jumping', () => {
    const { result, rerender } = renderHook(({ target }) => usePacedCursor(target), { initialProps: { target: 10 } });

    rerender({ target: 13 });
    expect(result.current).toBe(10);
    tick(1);
    expect(result.current).toBe(11);
    tick(4);
    expect(result.current).toBe(13);
  });

  it('catches up quickly over a long gap', () => {
    const { result, rerender } = renderHook(({ target }) => usePacedCursor(target), { initialProps: { target: 0 } });

    rerender({ target: 60 });
    tick(25); // about a second for a 60-word jump

    expect(result.current).toBe(60);
  });

  it('lands straight on a position far ahead, as when a session is picked up mid-chapter', () => {
    const { result, rerender } = renderHook(({ target }) => usePacedCursor(target), { initialProps: { target: 0 } });

    rerender({ target: 400 });

    expect(result.current).toBe(400);
  });

  it('moves straight back when the narrator restarts earlier', () => {
    const { result, rerender } = renderHook(({ target }) => usePacedCursor(target), { initialProps: { target: 47 } });

    rerender({ target: 27 });

    expect(result.current).toBe(27);
    rerender({ target: 30 });
    tick(6);
    expect(result.current).toBe(30);
  });

  it('does not animate for people who ask for reduced motion', () => {
    preferReducedMotion(true);
    const { result, rerender } = renderHook(({ target }) => usePacedCursor(target), { initialProps: { target: 10 } });

    rerender({ target: 30 });

    expect(result.current).toBe(30);
  });
});
