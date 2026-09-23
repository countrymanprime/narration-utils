import type { DictionaryInfo, DictionaryLookupResult } from './contracts/dictionary';

/** The approved dictionary as `config/dictionary-assets.json` names it, for the mock's answers. */
const MOCK_DICTIONARY: DictionaryInfo = {
  id: 'oewn-2025',
  provider: 'oewn',
  displayName: 'Open English WordNet 2025 (US English dictionary)',
  description: "Definitions, synonyms and antonyms for the reader's Look up, read from your own computer with no internet connection.",
  version: '2025',
  publisher: 'The Open English WordNet Team',
  license: 'CC-BY-4.0',
  licenseUrl: 'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md',
  modelCardUrl: 'https://en-word.net/',
  provenanceUrl: 'https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition',
  attribution:
    'Open English WordNet 2025 Edition, (c) 2019-present The Open English WordNet Team, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Derived from Princeton WordNet 3.0, (c) 2006 Princeton University, under the WordNet License (https://wordnet.princeton.edu/license-and-commercial-use). Reorganised into a lookup index on your computer; the wording is not changed.',
};

/** The few words the mock dictionary knows, keyed as the host keys them (lower case). */
const MOCK_ENTRIES: Record<string, Extract<DictionaryLookupResult, { status: 'ok' }>['entries']> = {
  curious: [
    {
      headword: 'curious',
      partOfSpeech: 'adjective',
      senses: [
        {
          definition: 'eager to investigate and learn or learn more (sometimes about others\u2019 concerns)',
          examples: ['a curious child is a teachable child'],
          synonyms: [],
          antonyms: ['incurious'],
        },
        {
          definition: 'beyond or deviating from the usual or expected',
          examples: ['a curious hybrid accent'],
          synonyms: ['funny', 'odd', 'peculiar', 'queer', 'rum', 'rummy', 'singular'],
          antonyms: [],
        },
      ],
    },
  ],
};

/**
 * The mock's SystemLookup: the same normalising and the same two answers as the host (apps/desktop/dictionarylookup.go), so the lookup UI can
 * be seen without a host. `missing` boots without the dictionary, so the answer is the first-use gate.
 */
export function mockDictionaryLookup(word: string, missing: boolean): DictionaryLookupResult {
  const query = word
    .trim()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();
  if (query === '' || /\s/.test(query) || [...query].length > 64) throw new Error('select a single word to look it up');
  if (missing) {
    return {
      status: 'asset_required',
      dictionary: MOCK_DICTIONARY,
      installState: 'not_installed',
      downloadSize: 9986555,
      diskSize: 17174403,
      installPath: 'C:/Users/narrator/AppData/Local/narration-utils/assets/dictionary/oewn/oewn-2025/2025',
    };
  }
  return { status: 'ok', query, entries: structuredClone(MOCK_ENTRIES[query] ?? []), dictionary: MOCK_DICTIONARY };
}
