// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { useReadAloudReaperState } from './useReadAloudReaperState';
import type { NarrationApi, ReadAloudReaperState } from '../../types';

function fakeApi(readAloudReaperState: NarrationApi['readAloudReaperState']): NarrationApi {
  return { readAloudReaperState } as unknown as NarrationApi;
}

function wrapper(api: NarrationApi) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api, children });
}

const STATE: ReadAloudReaperState = { status: 'ready', message: 'ready', trackGuid: '{1}', armedCount: 1, playing: false, recording: false };

describe('useReadAloudReaperState', () => {
  it('asks once when a chapter id is given, and reports the answer', async () => {
    const readAloudReaperState = vi.fn(async () => STATE);
    const { result } = renderHook(() => useReadAloudReaperState('chapter-1'), { wrapper: wrapper(fakeApi(readAloudReaperState)) });

    await waitFor(() => expect(result.current.state).toEqual(STATE));
    expect(readAloudReaperState).toHaveBeenCalledTimes(1);
    expect(readAloudReaperState).toHaveBeenCalledWith('chapter-1');
  });

  it('asks nothing without a chapter id (credits mode, the standalone page)', () => {
    const readAloudReaperState = vi.fn(async () => STATE);
    const { result } = renderHook(() => useReadAloudReaperState(undefined), { wrapper: wrapper(fakeApi(readAloudReaperState)) });

    expect(readAloudReaperState).not.toHaveBeenCalled();
    expect(result.current.state).toBeUndefined();
  });

  it('asks again on refresh, and re-asks (resetting) when the chapter id changes', async () => {
    const readAloudReaperState = vi.fn(async () => STATE);
    const { result, rerender } = renderHook((chapterId: string) => useReadAloudReaperState(chapterId), {
      wrapper: wrapper(fakeApi(readAloudReaperState)),
      initialProps: 'chapter-1',
    });
    await waitFor(() => expect(readAloudReaperState).toHaveBeenCalledTimes(1));

    act(() => result.current.refresh());
    await waitFor(() => expect(readAloudReaperState).toHaveBeenCalledTimes(2));

    rerender('chapter-2');
    await waitFor(() => expect(readAloudReaperState).toHaveBeenCalledTimes(3));
    expect(readAloudReaperState).toHaveBeenLastCalledWith('chapter-2');
  });

  it('reports a rejection as an error message, leaving state unset', async () => {
    const readAloudReaperState = vi.fn(async () => {
      throw new Error('the bridge is not connected');
    });
    const { result } = renderHook(() => useReadAloudReaperState('chapter-1'), { wrapper: wrapper(fakeApi(readAloudReaperState)) });

    await waitFor(() => expect(result.current.error).toBe('the bridge is not connected'));
    expect(result.current.state).toBeUndefined();
  });
});
