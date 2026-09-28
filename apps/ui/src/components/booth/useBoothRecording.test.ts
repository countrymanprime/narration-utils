// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import type { DawTransport } from '../../api/contracts/daw';
import type { NarrationApi } from '../../types';
import { useBoothRecording } from './useBoothRecording';

function fakeApi(): { api: NarrationApi; emit: (transport: DawTransport) => void } {
  const listeners = new Set<(transport: DawTransport) => void>();
  const api = {
    subscribeDawTransport: (onUpdate: (transport: DawTransport) => void) => {
      listeners.add(onUpdate);
      onUpdate({ playing: false, recording: false });
      return () => listeners.delete(onUpdate);
    },
  } as unknown as NarrationApi;
  return { api, emit: (transport) => listeners.forEach((listener) => listener(transport)) };
}

function wrapper(api: NarrationApi) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api, children });
}

describe('useBoothRecording (booth-mode-and-companion-panel.prd.md Phase 5, keyed on the Booth route)', () => {
  it('is false until both the Booth is showing and the DAW reports recording', () => {
    const { api, emit } = fakeApi();
    const { result, rerender } = renderHook(({ showing }) => useBoothRecording(showing), { wrapper: wrapper(api), initialProps: { showing: false } });
    expect(result.current).toBe(false);

    act(() => emit({ playing: true, recording: true }));
    expect(result.current).toBe(false);

    rerender({ showing: true });
    expect(result.current).toBe(true);
  });

  it('clears the moment either half clears', () => {
    const { api, emit } = fakeApi();
    const { result, rerender } = renderHook(({ showing }) => useBoothRecording(showing), { wrapper: wrapper(api), initialProps: { showing: true } });
    act(() => emit({ playing: true, recording: true }));
    expect(result.current).toBe(true);

    act(() => emit({ playing: false, recording: false }));
    expect(result.current).toBe(false);

    act(() => emit({ playing: true, recording: true }));
    expect(result.current).toBe(true);
    rerender({ showing: false });
    expect(result.current).toBe(false);
  });
});
