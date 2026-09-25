// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChapterSyncState } from '../api/contracts/chapterSync';
import { useChapterSync } from './useChapterSync';

const state = (overrides: Partial<ChapterSyncState> = {}): ChapterSyncState => ({
  consent: 'on',
  decidedAt: '2026-09-24T09:00:00Z',
  ask: false,
  manuscript: true,
  dawLinked: true,
  project: 'ready',
  message: '',
  projectFile: 'Alice.rpp',
  savedAt: '2026-09-24T09:00:00Z',
  lastSync: '2026-09-24T09:00:00Z',
  counts: { linked: 1, needsYou: 0, noTrack: 0, unmatched: 0, pickupTracks: 0 },
  batch: null,
  unsavedEdits: false,
  activity: [],
  ...overrides,
});

function fakeApi(initial: ChapterSyncState) {
  const subscribers = new Set<(next: ChapterSyncState) => void>();
  return {
    api: {
      chapterSyncState: vi.fn().mockResolvedValue(initial),
      subscribeChapterSync: vi.fn((onUpdate: (next: ChapterSyncState) => void) => {
        subscribers.add(onUpdate);
        return () => subscribers.delete(onUpdate);
      }),
    },
    publish: (next: ChapterSyncState) => subscribers.forEach((fn) => fn(next)),
    subscriberCount: () => subscribers.size,
  };
}

describe('useChapterSync', () => {
  it('reads the state once on mount', async () => {
    const { api } = fakeApi(state());
    const { result } = renderHook(() => useChapterSync(api));
    await waitFor(() => expect(result.current).toEqual(state()));
    expect(api.chapterSyncState).toHaveBeenCalledOnce();
  });

  it('follows chaptersync:state after the initial read', async () => {
    const { api, publish } = fakeApi(state());
    const { result } = renderHook(() => useChapterSync(api));
    await waitFor(() => expect(result.current).toBeDefined());
    const withBatch = state({ batch: { at: '2026-09-25T10:00:00Z', trigger: 'daw-link', linked: [], newTracks: [] } });
    act(() => publish(withBatch));
    expect(result.current).toEqual(withBatch);
  });

  it('keeps an event that arrives before the initial read resolves, instead of letting the read overwrite it with its own batch: null', async () => {
    const subscribers = new Set<(next: ChapterSyncState) => void>();
    let resolveRead!: (value: ChapterSyncState) => void;
    const api = {
      chapterSyncState: vi.fn(() => new Promise<ChapterSyncState>((resolve) => (resolveRead = resolve))),
      subscribeChapterSync: vi.fn((onUpdate: (next: ChapterSyncState) => void) => {
        subscribers.add(onUpdate);
        return () => subscribers.delete(onUpdate);
      }),
    };
    const { result } = renderHook(() => useChapterSync(api));
    const withBatch = state({ batch: { at: '2026-09-25T10:00:00Z', trigger: 'daw-link', linked: [], newTracks: [] } });
    act(() => subscribers.forEach((fn) => fn(withBatch)));
    expect(result.current).toEqual(withBatch);
    // The still-in-flight initial read now resolves with a plain (batch: null) snapshot from before the event; it
    // must not clobber the event that already arrived.
    await act(async () => resolveRead(state()));
    expect(result.current).toEqual(withBatch);
  });

  it('leaves the state undefined when the initial read fails, until a real event arrives (SILENT_CATCHES)', async () => {
    const subscribers = new Set<(next: ChapterSyncState) => void>();
    const api = {
      chapterSyncState: vi.fn().mockRejectedValue(new Error('offline')),
      subscribeChapterSync: vi.fn((onUpdate: (next: ChapterSyncState) => void) => {
        subscribers.add(onUpdate);
        return () => subscribers.delete(onUpdate);
      }),
    };
    const { result } = renderHook(() => useChapterSync(api));
    await waitFor(() => expect(api.chapterSyncState).toHaveBeenCalledOnce());
    expect(result.current).toBeUndefined();
    act(() => subscribers.forEach((fn) => fn(state())));
    expect(result.current).toEqual(state());
  });

  it('unsubscribes on unmount', async () => {
    const { api, subscriberCount } = fakeApi(state());
    const { unmount } = renderHook(() => useChapterSync(api));
    await waitFor(() => expect(subscriberCount()).toBe(1));
    unmount();
    expect(subscriberCount()).toBe(0);
  });
});
