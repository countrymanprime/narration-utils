// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { ApiProvider } from './api/ApiContext';
import { createDawMock, type DawMockSeed } from './api/dawMock';
import type { DawCapabilities } from './api/contracts/daw';
import { useCapability } from './useCapability';
import type { NarrationApi } from './types';

function wrapper(api: Pick<NarrationApi, 'dawCapabilities' | 'subscribeDawCapabilities'>) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api: api as NarrationApi, children });
}

describe('useCapability', () => {
  it('reads the entry for a known capability from the first dawCapabilities() answer', async () => {
    const api = createDawMock({ daw: 'REAPER', toggles: { punch: 'on' }, experimentalOn: true });
    const { result } = renderHook(() => useCapability('punch'), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.level).toBe('experimental');
  });

  it('follows a daw_capabilities_changed update for the same capability', async () => {
    let onUpdate: ((state: DawCapabilities) => void) | undefined;
    const seed: DawMockSeed = { daw: 'REAPER', toggles: { punch: 'off' } };
    const base = createDawMock(seed);
    const api: Pick<NarrationApi, 'dawCapabilities' | 'subscribeDawCapabilities'> = {
      dawCapabilities: base.dawCapabilities,
      subscribeDawCapabilities: (fn) => {
        onUpdate = fn;
        return base.subscribeDawCapabilities(fn);
      },
    };
    const { result } = renderHook(() => useCapability('punch'), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.level).toBe('experimental'));
    expect(result.current.available).toBe(false);
    expect(result.current.message).toBe('Turned off in Settings.');

    act(() => {
      onUpdate?.({
        daw: 'REAPER',
        reachable: true,
        capabilities: { punch: { level: 'experimental', available: true } },
      });
    });
    await waitFor(() => expect(result.current.available).toBe(true));
  });

  it('treats an unknown capability as unsupported and unavailable', async () => {
    const api = createDawMock({ daw: 'REAPER' });
    // @ts-expect-error exercising a capability key the host report does not carry
    const { result } = renderHook(() => useCapability('not_a_real_capability'), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current).toEqual({ level: 'unsupported', available: false }));
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
    const { result, unmount } = renderHook(() => useCapability('review'), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.available).toBe(true));
    unmount();
    expect(unsubscribed).toBe(true);
  });
});
