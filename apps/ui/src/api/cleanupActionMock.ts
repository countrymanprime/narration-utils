// The browser mock's silence trim and item gain (booth-actions-enablement PRD Phase 5). cleanupPreview/cleanupApply
// read the same findings store editingCandidates already reads (a candidate is seeded like any other finding,
// editingCandidateFor in mockFixtures.ts); levelMatchPreview/levelMatchApply hold their own small, self-contained
// fixture of gain candidates, since nothing else in the mock measures REAPER item levels.
import type { CleanupActionApi, GainCandidate } from '../types';
import { wireClone } from './mockFixtures';

export type CleanupActionSeed = {
  /** The gain candidates levelMatchPreview offers before any levelMatchApply call. */
  gainCandidates?: GainCandidate[];
};

const DEFAULT_GAIN_CANDIDATES: GainCandidate[] = [{ itemGuid: '{99990001-0000-4000-8000-000000000001}', deltaDb: 2.4 }];

export function createCleanupActionMock(findingsForChapter: (chapterId: string) => Promise<unknown[]>, seed?: CleanupActionSeed): CleanupActionApi {
  let gainCandidates = wireClone(seed?.gainCandidates ?? DEFAULT_GAIN_CANDIDATES);

  return {
    cleanupPreview: async (chapterId) => {
      const found = await findingsForChapter(chapterId);
      if (found.length === 0) throw new Error('no silence-trim candidates were found for this chapter');
      return { candidates: found.length, added: found.length, existing: 0, stale: [] };
    },
    cleanupApply: async (chapterId) => {
      const found = await findingsForChapter(chapterId);
      if (found.length === 0) throw new Error('no silence-trim candidates were found for this chapter');
      return { candidates: found.length, applied: found.length, stale: [] };
    },
    levelMatchPreview: async () => {
      if (gainCandidates.length === 0) throw new Error("no item on this chapter's linked track needs a gain change");
      return { candidates: wireClone(gainCandidates) };
    },
    levelMatchApply: async () => {
      if (gainCandidates.length === 0) throw new Error("no item on this chapter's linked track needs a gain change");
      const changed = gainCandidates.map((candidate) => ({
        itemGuid: candidate.itemGuid,
        beforeVolume: 1,
        afterVolume: 10 ** (candidate.deltaDb / 20),
      }));
      gainCandidates = [];
      return { changed, stale: [] };
    },
  };
}
