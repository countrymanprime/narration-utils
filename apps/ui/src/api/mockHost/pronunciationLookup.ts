// The mock host (mockApi.ts): the four web pronunciation lookup sites (PronunciationLookupOpen).
import type { NarrationApi, PronunciationLookupSource } from '../../types';

const KNOWN_SOURCES: readonly PronunciationLookupSource[] = ['forvo', 'youglish', 'merriam_webster', 'howjsay'];

/**
 * The pronunciation lookup binding. The mock has no real browser to open: it only proves the call reached a known
 * source and a non-blank word, matching the Go binding's own guards (pronunciationlookup.URL).
 */
export function createPronunciationLookupMock() {
  return {
    pronunciationLookupOpen: async (source, word) => {
      if (!KNOWN_SOURCES.includes(source)) throw new Error(`Unknown pronunciation lookup source "${source}"`);
      if (word.trim() === '') throw new Error('pronunciationLookupOpen: empty word');
    },
  } satisfies Partial<NarrationApi>;
}
