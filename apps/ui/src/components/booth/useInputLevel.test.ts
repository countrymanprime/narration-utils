// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { useInputLevel } from './useInputLevel';
import type { NarrationApi, TeleprompterEvent } from '../../types';

afterEach(() => vi.restoreAllMocks());

function fakeApi(overrides: Partial<NarrationApi> = {}): { api: NarrationApi; emit: (event: TeleprompterEvent) => void } {
  const listeners = new Set<(event: TeleprompterEvent) => void>();
  const api = {
    subscribeTeleprompterEvent: (onEvent: (event: TeleprompterEvent) => void) => {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    teleprompterMeterStart: vi.fn(async () => {}),
    teleprompterMeterStop: vi.fn(async () => {}),
    ...overrides,
  } as unknown as NarrationApi;
  return { api, emit: (event) => listeners.forEach((listener) => listener(event)) };
}

function wrapper(api: NarrationApi) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api, children });
}

describe('useInputLevel', () => {
  it("reflects level events from the shared subscription (a running session's own levels)", () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useInputLevel('Shure MV7', { active: true, enabled: false }), { wrapper: wrapper(api) });

    expect(result.current.level).toBeNull();
    act(() => emit({ type: 'level', peak: -12, rms: -24 }));
    expect(result.current.level).toEqual({ peak: -12, rms: -24 });
    expect(api.teleprompterMeterStart).not.toHaveBeenCalled();
  });

  it('holds the peak for a while before a lower one is allowed to replace it', () => {
    vi.useFakeTimers();
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useInputLevel('Shure MV7', { active: true, enabled: false }), { wrapper: wrapper(api) });

    act(() => emit({ type: 'level', peak: -6, rms: -10 }));
    expect(result.current.level?.peak).toBe(-6);

    // A quieter chunk right after a loud one keeps the held peak (the RMS still moves, so the meter is not frozen).
    act(() => emit({ type: 'level', peak: -40, rms: -40 }));
    expect(result.current.level).toEqual({ peak: -6, rms: -40 });

    // Once the hold window elapses, a new (lower) peak is allowed through.
    act(() => vi.advanceTimersByTime(1600));
    act(() => emit({ type: 'level', peak: -40, rms: -40 }));
    expect(result.current.level?.peak).toBe(-40);
    vi.useRealTimers();
  });

  it('clears the level and records the reason on meter_stopped', () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useInputLevel('Shure MV7', { active: false, enabled: true }), { wrapper: wrapper(api) });

    act(() => emit({ type: 'level', peak: -12, rms: -24 }));
    expect(result.current.level).not.toBeNull();

    act(() => emit({ type: 'meter_stopped', error: 'the microphone would not open' }));
    expect(result.current.level).toBeNull();
    expect(result.current.error).toBe('the microphone would not open');
  });

  it('runs the meter-only mode only while enabled and not active, and stops it when either changes', async () => {
    const { api } = fakeApi();
    const { rerender, unmount } = renderHook(({ enabled, active }) => useInputLevel('Shure MV7', { active, enabled }), {
      wrapper: wrapper(api),
      initialProps: { enabled: false, active: false },
    });
    expect(api.teleprompterMeterStart).not.toHaveBeenCalled();

    rerender({ enabled: true, active: false });
    await waitFor(() => expect(api.teleprompterMeterStart).toHaveBeenCalledWith('Shure MV7'));
    expect(api.teleprompterMeterStop).not.toHaveBeenCalled();

    rerender({ enabled: true, active: true });
    await waitFor(() => expect(api.teleprompterMeterStop).toHaveBeenCalledTimes(1));
    expect(api.teleprompterMeterStart).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('never starts the meter-only mode while a session is active, even if enabled', () => {
    const { api } = fakeApi();
    renderHook(() => useInputLevel('Shure MV7', { active: true, enabled: true }), { wrapper: wrapper(api) });
    expect(api.teleprompterMeterStart).not.toHaveBeenCalled();
  });
});
