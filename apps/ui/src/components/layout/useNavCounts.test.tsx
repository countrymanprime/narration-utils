// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi as Api } from '../../types';
import { useNavCounts } from './useNavCounts';

const wrap = (api: Api) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider api={api}>{children}</ApiProvider>;
  };

describe('useNavCounts (rail badges, N-B61)', () => {
  it('reads the open pronunciation queries, the notes to review and the pickups remaining from the host', async () => {
    const base = createMockApi({}, {});
    const api: Api = {
      ...base,
      guidePronunciationQueries: async () => [{ status: 'open' }, { status: 'open' }, { status: 'open' }] as never,
      findingsSummary: async () => ({ ...(await base.findingsSummary()), unreviewed: 14 }),
      pickupsState: async () => ({ phase: 'counted', message: '', remaining: 9, total: 12, csv: '' }) as never,
    };
    const { result } = renderHook(() => useNavCounts('/', true), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current).toEqual({ storyBible: 3, proof: 14, pickups: 9 }));
  });

  it('leaves a count out when its call fails, rather than drawing a made-up number', async () => {
    const base = createMockApi({}, {});
    const api: Api = {
      ...base,
      guidePronunciationQueries: async () => {
        throw new Error('no manuscript');
      },
      findingsSummary: async () => ({ ...(await base.findingsSummary()), unreviewed: 2 }),
      pickupsState: async () => {
        throw new Error('no reaper');
      },
    };
    const { result } = renderHook(() => useNavCounts('/', true), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.proof).toBe(2));
    expect(result.current.storyBible).toBeUndefined();
    expect(result.current.pickups).toBeUndefined();
  });

  it('does not ask the Story Bible before there is a manuscript', async () => {
    const base = createMockApi({}, {});
    let asked = false;
    const api: Api = {
      ...base,
      guidePronunciationQueries: async () => {
        asked = true;
        return [];
      },
    };
    renderHook(() => useNavCounts('/', false), { wrapper: wrap(api) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toBe(false);
  });
});
