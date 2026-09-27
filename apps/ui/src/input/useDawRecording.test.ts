// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { ApiProvider } from '../api/ApiContext';
import { createDawMock } from '../api/dawMock';
import type { DawTransport } from '../api/contracts/daw';
import { useDawRecording } from './useDawRecording';
import type { NarrationApi } from '../types';

function wrapper(api: Pick<NarrationApi, 'subscribeDawTransport'>) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api: api as NarrationApi, children });
}

describe('useDawRecording', () => {
  it('defaults to not recording with nothing seeded', () => {
    const api = createDawMock({});
    const { result } = renderHook(() => useDawRecording(), { wrapper: wrapper(api) });
    expect(result.current()).toBe(false);
  });

  it('reads the seeded transport (daw-port-and-capabilities.prd.md Phase 9) on mount', () => {
    const api = createDawMock({ daw: 'REAPER', transport: { playing: true, recording: true } });
    const { result } = renderHook(() => useDawRecording(), { wrapper: wrapper(api) });
    expect(result.current()).toBe(true);
  });

  it('a paused recording (playing false, recording true) still counts as recording', () => {
    const api = createDawMock({ daw: 'REAPER', transport: { playing: false, recording: true } });
    const { result } = renderHook(() => useDawRecording(), { wrapper: wrapper(api) });
    expect(result.current()).toBe(true);
  });

  it('follows a daw_transport_changed update', () => {
    let onUpdate: ((state: DawTransport) => void) | undefined;
    const base = createDawMock({ daw: 'REAPER', transport: { playing: false, recording: false } });
    const api: Pick<NarrationApi, 'subscribeDawTransport'> = {
      subscribeDawTransport: (fn) => {
        onUpdate = fn;
        return base.subscribeDawTransport(fn);
      },
    };
    const { result } = renderHook(() => useDawRecording(), { wrapper: wrapper(api) });
    expect(result.current()).toBe(false);

    act(() => {
      onUpdate?.({ playing: true, recording: true, position: 4 });
    });
    expect(result.current()).toBe(true);

    act(() => {
      onUpdate?.({ playing: false, recording: false });
    });
    expect(result.current()).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    let unsubscribed = false;
    const base = createDawMock({});
    const api: Pick<NarrationApi, 'subscribeDawTransport'> = {
      subscribeDawTransport: (fn) => {
        const unsubscribe = base.subscribeDawTransport(fn);
        return () => {
          unsubscribed = true;
          unsubscribe();
        };
      },
    };
    const { unmount } = renderHook(() => useDawRecording(), { wrapper: wrapper(api) });
    unmount();
    expect(unsubscribed).toBe(true);
  });
});
