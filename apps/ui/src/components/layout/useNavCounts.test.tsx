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
  it("reads the Story Bible's Needs Review entries, the notes to review and the pickups remaining from the host", async () => {
    const base = createMockApi({}, {});
    const api: Api = {
      ...base,
      guideEntities: async () => (await base.guideEntities()).map((entity, index) => ({ ...entity, category: index < 3 ? 'Needs Review' : 'Character' })),
      findingsSummary: async () => ({ ...(await base.findingsSummary()), unreviewed: 14 }),
      pickupsState: async () => ({ phase: 'counted', message: '', remaining: 9, total: 12, csv: '' }) as never,
    };
    const { result } = renderHook(() => useNavCounts('/', true), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current).toEqual({ storyBible: 3, proof: 14, pickups: 9 }));
  });

  it('counts an entry by its category, not by its pronunciation: a name with an open query is not a Needs Review entry', async () => {
    const base = createMockApi({}, {});
    const [first, ...rest] = await base.guideEntities();
    const api: Api = {
      ...base,
      guideEntities: async () => [{ ...first, category: 'Needs Review' }, ...rest.map((entity) => ({ ...entity, category: 'Character' }))],
      guidePronunciationQueries: async () => {
        throw new Error('the rail no longer asks for the queries');
      },
    };
    const { result } = renderHook(() => useNavCounts('/', true), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.storyBible).toBe(1));
  });

  it('draws no Story Bible count once every entry has a category', async () => {
    const base = createMockApi({}, {});
    const api: Api = { ...base, guideEntities: async () => (await base.guideEntities()).map((entity) => ({ ...entity, category: 'Character' })) };
    const { result } = renderHook(() => useNavCounts('/', true), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.proof).toBeDefined());
    expect(result.current.storyBible).toBe(0);
  });

  it('leaves a count out when its call fails, rather than drawing a made-up number', async () => {
    const base = createMockApi({}, {});
    const api: Api = {
      ...base,
      guideEntities: async () => {
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
      guideEntities: async () => {
        asked = true;
        return [];
      },
    };
    renderHook(() => useNavCounts('/', false), { wrapper: wrap(api) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toBe(false);
  });
});
