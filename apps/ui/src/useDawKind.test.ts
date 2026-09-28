// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { ApiProvider } from './api/ApiContext';
import { createDawMock } from './api/dawMock';
import type { DawCapabilities } from './api/contracts/daw';
import { useDawKind } from './useDawKind';
import type { NarrationApi } from './types';

function wrapper(api: Pick<NarrationApi, 'dawCapabilities' | 'subscribeDawCapabilities'>) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api: api as NarrationApi, children });
}

describe('useDawKind', () => {
  it('reads the daw kind from the first dawCapabilities() answer', async () => {
    const api = createDawMock({ daw: 'Audacity' });
    const { result } = renderHook(() => useDawKind(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current).toBe('Audacity'));
  });

  it('defaults to REAPER-shaped behaviour (undefined) until the first answer', () => {
    let resolveCapabilities: (value: DawCapabilities) => void = () => undefined;
    const api: Pick<NarrationApi, 'dawCapabilities' | 'subscribeDawCapabilities'> = {
      dawCapabilities: () => new Promise((resolve) => (resolveCapabilities = resolve)),
      subscribeDawCapabilities: () => () => {},
    };
    const { result } = renderHook(() => useDawKind(), { wrapper: wrapper(api) });
    expect(result.current).toBeUndefined();
    resolveCapabilities({ daw: 'REAPER', reachable: true, capabilities: {} });
  });

  it('follows a daw_capabilities_changed update', async () => {
    let onUpdate: ((state: DawCapabilities) => void) | undefined;
    const base = createDawMock({ daw: 'REAPER' });
    const api: Pick<NarrationApi, 'dawCapabilities' | 'subscribeDawCapabilities'> = {
      dawCapabilities: base.dawCapabilities,
      subscribeDawCapabilities: (fn) => {
        onUpdate = fn;
        return base.subscribeDawCapabilities(fn);
      },
    };
    const { result } = renderHook(() => useDawKind(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current).toBe('REAPER'));

    act(() => {
      onUpdate?.({ daw: 'Audacity', reachable: false, capabilities: {} });
    });
    await waitFor(() => expect(result.current).toBe('Audacity'));
  });

  it('unsubscribes on unmount', async () => {
    let unsubscribed = false;
    const base = createDawMock({ daw: 'REAPER' });
    const api: Pick<NarrationApi, 'dawCapabilities' | 'subscribeDawCapabilities'> = {
      dawCapabilities: base.dawCapabilities,
      subscribeDawCapabilities: (fn) => {
        const unsubscribe = base.subscribeDawCapabilities(fn);
        return () => {
          unsubscribed = true;
          unsubscribe();
        };
      },
    };
    const { result, unmount } = renderHook(() => useDawKind(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current).toBe('REAPER'));
    unmount();
    expect(unsubscribed).toBe(true);
  });
});
