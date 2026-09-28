// The mock host (mockApi.ts): the online pronunciation lookup (PronunciationOnline*, prep-depth P9). It keeps the Go
// service's rules (pronunciationonline.CheckWord, the key's shape, the cache, the confirmed batch) so a screen built
// against it meets the same refusals the host gives, and never reaches the network (D67).
import type { NarrationApi, PronunciationOnlineKeyStatus, PronunciationOnlineResult, PronunciationOnlineSpelling } from '../../types';
import { PRONUNCIATION_ONLINE_MAX_BATCH } from '../contracts/pronunciationOnline';
import { onlineBatchWords, onlineWord } from '../../pronunciationOnlineWords';

const NOT_A_WORD = 'an online lookup sends one word or name only: letters, digits, spaces, apostrophes, hyphens and periods, at most 3 words and 64 characters';

// The answers the mock dictionary knows, keyed by the lower-cased word; the fake Go dictionary knows the same first three.
const ANSWERS: Record<string, { pronunciations: PronunciationOnlineSpelling[]; suggestions?: string[] }> = {
  croquet: { pronunciations: [{ headword: 'cro·quet', spelling: 'krō-ˈkā' }] },
  wren: { pronunciations: [{ headword: 'wren', spelling: 'ˈren' }] },
  quorlen: { pronunciations: [], suggestions: ['quorum', 'sorrel'] },
  alice: { pronunciations: [{ headword: 'Al·ice', spelling: 'ˈa-ləs' }] },
  hatter: { pronunciations: [{ headword: 'hat·ter', spelling: 'ˈha-tər' }] },
  caterpillar: { pronunciations: [{ headword: 'cat·er·pil·lar', spelling: 'ˈka-tə(r)-ˌpi-lər' }] },
};

function checkOnlineWord(raw: string): string {
  const word = onlineWord(raw);
  if (word === undefined) throw new Error(NOT_A_WORD);
  return word;
}

export function createPronunciationOnlineMock(options: { keySaved?: boolean } = {}) {
  let keySaved = options.keySaved ?? false;
  const cache = new Map<string, Omit<PronunciationOnlineResult, 'cached'>>();
  const status = (): PronunciationOnlineKeyStatus => ({ source: 'merriam_webster', label: 'Merriam-Webster', present: keySaved, protectedAtRest: true });

  const lookup = (raw: string): { result: PronunciationOnlineResult; fetched: boolean } => {
    const word = checkOnlineWord(raw);
    const hit = cache.get(word.toLowerCase());
    if (hit) return { result: { ...hit, cached: true }, fetched: false };
    if (!keySaved) throw new Error('add your own free Merriam-Webster key in Settings > Story Bible first');
    const known = ANSWERS[word.toLowerCase()];
    const answer: Omit<PronunciationOnlineResult, 'cached'> = {
      word,
      source: 'merriam_webster',
      label: 'Merriam-Webster',
      notation: 'Merriam-Webster respelling',
      found: (known?.pronunciations.length ?? 0) > 0,
      pronunciations: known?.pronunciations ?? [],
      suggestions: known?.suggestions ?? [],
      fetchedAt: '2026-09-27T21:00:00Z',
    };
    cache.set(word.toLowerCase(), answer);
    return { result: { ...answer, cached: false }, fetched: true };
  };

  return {
    pronunciationOnlineKeyStatus: async () => status(),
    pronunciationOnlineKeySet: async (key) => {
      if (!/^[A-Za-z0-9-]{8,128}$/.test(key.trim())) {
        throw new Error('that does not look like a Merriam-Webster key: paste the key shown on your dictionaryapi.com account page');
      }
      keySaved = true;
      return status();
    },
    pronunciationOnlineKeyClear: async () => {
      keySaved = false;
      return status();
    },
    pronunciationOnlineSignUpOpen: async () => {},
    pronunciationOnlineLookup: async (word) => lookup(word).result,
    pronunciationOnlineLookupBatch: async (raw, confirmedCount) => {
      const { words, leftOut } = onlineBatchWords(raw);
      if (words.length === 0 || leftOut > 0) throw new Error(NOT_A_WORD);
      if (words.length > PRONUNCIATION_ONLINE_MAX_BATCH) throw new Error('a batch lookup sends at most 200 words at a time');
      if (confirmedCount !== words.length) throw new Error('a batch lookup needs your confirmation of how many words it sends');
      const result = { words: words.length, fetched: 0, fromCache: 0, notFound: 0, failed: 0, stopped: false, stopReason: '' };
      for (const word of words) {
        const { result: answer, fetched } = lookup(word);
        if (fetched) result.fetched += 1;
        else result.fromCache += 1;
        if (!answer.found) result.notFound += 1;
      }
      return result;
    },
  } satisfies Partial<NarrationApi>;
}
