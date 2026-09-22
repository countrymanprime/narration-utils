// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingAction } from './usePendingAction';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// A stub that never settles until the test lets it.
function stub() {
  let settle: (value: string) => void = () => {};
  const action = vi.fn(() => new Promise<string>((resolve) => (settle = resolve)));
  return { action, settle: (value = 'done') => settle(value) };
}

describe('usePendingAction', () => {
  it('marks the key pending within 100 ms of the call and clears it when the action settles', async () => {
    const { result } = renderHook(() => usePendingAction());
    const { action, settle } = stub();
    let outcome: Promise<string | undefined> = Promise.resolve(undefined);
    act(() => void (outcome = result.current.run('save', action)));
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current.isPending('save')).toBe(true);
    expect(result.current.isBusy).toBe(true);
    await act(async () => {
      settle('saved');
      await outcome;
    });
    expect(await outcome).toBe('saved');
    expect(result.current.isPending('save')).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it('makes two rapid calls one call, even when the second arrives before React has re-rendered', () => {
    const { result } = renderHook(() => usePendingAction());
    const { action } = stub();
    act(() => {
      void result.current.run('save', action);
      void result.current.run('save', action);
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('refuses a different action while one runs, and reports the others as blocked', async () => {
    const { result } = renderHook(() => usePendingAction());
    const first = stub();
    const second = stub();
    act(() => void result.current.run('save', first.action));
    let refused: string | undefined = 'not called';
    await act(async () => {
      refused = await result.current.run('rescan', second.action);
    });
    expect(refused).toBeUndefined();
    expect(second.action).not.toHaveBeenCalled();
    expect(result.current.isBlockedFor('rescan')).toBe(true);
    expect(result.current.isBlockedFor('save')).toBe(false);
  });

  it('releases the key when the action throws, so pressing again retries', async () => {
    const { result } = renderHook(() => usePendingAction());
    await act(async () => {
      await result.current.run('save', () => Promise.reject(new Error('the host said no'))).catch(() => undefined);
    });
    expect(result.current.isBusy).toBe(false);
    const { action } = stub();
    act(() => void result.current.run('save', action));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
