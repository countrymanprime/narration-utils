// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useZoom } from './useZoom';

afterEach(() => {
  vi.useRealTimers();
});

function fakeApi(initialLevel = 1.0) {
  let level = initialLevel;
  return {
    windowZoom: vi.fn(async () => ({ level })),
    windowSetZoom: vi.fn(async (factor: number) => {
      level = factor;
      return { level };
    }),
  };
}

describe('useZoom', () => {
  it('reads the level once on mount', async () => {
    const api = fakeApi(1.25);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(1.25));
    expect(result.current.percent).toBe(125);
    expect(api.windowZoom).toHaveBeenCalledOnce();
  });

  it('zoomIn steps to the next of the six levels from the nearest step', async () => {
    const api = fakeApi(1.0);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(1.0));

    await act(async () => result.current.zoomIn());
    await waitFor(() => expect(result.current.level).toBe(1.1));
    expect(api.windowSetZoom).toHaveBeenLastCalledWith(1.1);

    await act(async () => result.current.zoomIn());
    await waitFor(() => expect(result.current.level).toBe(1.25));
  });

  it('zoomOut steps to the previous level', async () => {
    const api = fakeApi(1.5);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(1.5));

    await act(async () => result.current.zoomOut());
    await waitFor(() => expect(result.current.level).toBe(1.25));
    expect(api.windowSetZoom).toHaveBeenLastCalledWith(1.25);
  });

  it('reset always sets 100%, from any level', async () => {
    const api = fakeApi(1.75);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(1.75));

    await act(async () => result.current.reset());
    await waitFor(() => expect(result.current.level).toBe(1.0));
    expect(api.windowSetZoom).toHaveBeenLastCalledWith(1.0);
  });

  it('zoom out is disabled at 100% and zoom in is disabled at 200% (ADR 0201)', async () => {
    const atFloor = fakeApi(1.0);
    const { result: floor } = renderHook(() => useZoom(atFloor));
    await waitFor(() => expect(floor.current.canZoomOut).toBe(false));
    expect(floor.current.canZoomIn).toBe(true);

    const atCeiling = fakeApi(2.0);
    const { result: ceiling } = renderHook(() => useZoom(atCeiling));
    await waitFor(() => expect(ceiling.current.canZoomIn).toBe(false));
    expect(ceiling.current.canZoomOut).toBe(true);
  });

  it('a level under 100% (only reachable by Ctrl+wheel/pinch) disables zoom out, same as sitting at 100%', async () => {
    const api = fakeApi(0.75);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(0.75));
    expect(result.current.canZoomOut).toBe(false);
  });

  it('a resize above the 200% ceiling (an external Ctrl+wheel/pinch) is set back to it (ADR 0201 item 2)', async () => {
    const api = fakeApi(1.0);
    renderHook(() => useZoom(api));
    await waitFor(() => expect(api.windowZoom).toHaveBeenCalledOnce());
    api.windowZoom.mockResolvedValueOnce({ level: 3.0 });

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await Promise.resolve();
    });

    expect(api.windowSetZoom).toHaveBeenCalledWith(2.0);
  });

  it('a resize under 100% (an external Ctrl+wheel/pinch) is only shown, never pushed back up', async () => {
    const api = fakeApi(1.0);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(api.windowZoom).toHaveBeenCalledOnce());
    api.windowZoom.mockResolvedValueOnce({ level: 0.6 });

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await Promise.resolve();
    });

    expect(api.windowSetZoom).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.level).toBe(0.6));
  });

  it('announces the settled level once, debounced, and never announces the initial mount read', async () => {
    vi.useFakeTimers();
    const api = fakeApi(1.0);
    const { result } = renderHook(() => useZoom(api));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(result.current.announcement).toBe('');

    await act(async () => result.current.zoomIn());
    expect(result.current.level).toBe(1.1);
    expect(result.current.announcement).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(result.current.announcement).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.announcement).toBe('Zoom 110%');
  });

  it('a run of wheel notches announces only the level the narrator settles on', async () => {
    vi.useFakeTimers();
    const api = fakeApi(1.0);
    const { result } = renderHook(() => useZoom(api));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => result.current.zoomIn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => result.current.zoomIn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.level).toBe(1.25);
    expect(result.current.announcement).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.announcement).toBe('Zoom 125%');
  });

  it('a failed initial read is silent: the readout stays at its 100% default (SILENT_CATCHES #1)', async () => {
    const api = { windowZoom: vi.fn().mockRejectedValue(new Error('offline')), windowSetZoom: vi.fn() };
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(api.windowZoom).toHaveBeenCalledOnce());
    expect(result.current.level).toBe(1.0);
  });

  it('a failed zoomIn/zoomOut/reset is silent: the level stays at what it was before the click (SILENT_CATCHES #2)', async () => {
    const api = fakeApi(1.25);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(1.25));
    api.windowSetZoom.mockRejectedValueOnce(new Error('offline'));

    await act(async () => result.current.zoomIn());

    expect(result.current.level).toBe(1.25);
  });

  it('a failed resize re-read is silent: the level stays at its last known value (SILENT_CATCHES #3)', async () => {
    const api = fakeApi(1.25);
    const { result } = renderHook(() => useZoom(api));
    await waitFor(() => expect(result.current.level).toBe(1.25));
    api.windowZoom.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.level).toBe(1.25);
  });
});
