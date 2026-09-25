import { useEffect, useState } from 'react';
import type { ChapterSyncApi, ChapterSyncState } from '../api/contracts/chapterSync';

/**
 * Chapter sync's live state (daw-chapter-track-auto-sync PRD Phase 3): read once with `chapterSyncState()`, then kept
 * current by `chaptersync:state`, sent after every link path, sync and Undo. `undefined` until the first read
 * resolves. Home and Tracks each call this to drive their own display from the same one subscription shape.
 */
export function useChapterSync(api: Pick<ChapterSyncApi, 'chapterSyncState' | 'subscribeChapterSync'>): ChapterSyncState | undefined {
  const [state, setState] = useState<ChapterSyncState>();
  useEffect(() => {
    // A sync the subscription's own attach can trigger (the first sync after consent) may finish before the plain
    // read below does; once any event has arrived, that read is answering a question that is already stale, so it
    // is dropped rather than allowed to overwrite a real event with its own always-`batch: null` snapshot.
    let receivedEvent = false;
    const unsubscribe = api.subscribeChapterSync((next) => {
      receivedEvent = true;
      setState(next);
    });
    void api.chapterSyncState().then((next) => {
      if (!receivedEvent) setState(next);
    });
    return unsubscribe;
  }, [api]);
  return state;
}
