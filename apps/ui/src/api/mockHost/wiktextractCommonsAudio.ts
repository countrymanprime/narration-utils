// The mock host (mockApi.ts): the Commons audio link Wiktextract's own offline data names for a word (prep-depth P10, D72, Q12).
// The real Wiktextract source is not yet installable from Settings (#782's own deferred fast-follow), so this mock stands in for
// Phase 8's own index with a small fixture (D67, mock-first behind the port): a couple of demo words have a Commons file, most
// don't, and there is no real browser to open - it only proves the call reached a known word with an audio file.
import type { NarrationApi } from '../../types';

// A tiny fixture in Wiktextract's own shape (word -> Commons file name), standing in for Phase 8's installed index until #782's
// deferred Settings-installability wiring lands and this mock can read a real one.
const FIXTURE_AUDIO: Readonly<Record<string, string>> = {
  alice: 'LL-Q1860 (eng)-Back ache-Alice.wav',
  happy: 'En-us-happy.ogg',
};

export function createPronunciationCommonsAudioMock() {
  return {
    pronunciationCommonsAudioOpen: async (word: string) => {
      const key = word.trim().toLowerCase();
      if (!key) throw new Error('pronunciationCommonsAudioOpen: empty word');
      if (!(key in FIXTURE_AUDIO)) throw new Error(`No Wikimedia Commons audio file is recorded for "${word}".`);
    },
  } satisfies Partial<NarrationApi>;
}
