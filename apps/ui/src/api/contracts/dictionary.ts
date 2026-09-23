import type { AssetInstallState } from './assets';

/**
 * The offline dictionary a lookup reads (ADR 0097: the Open English WordNet, CC BY 4.0). `attribution` is the credit its licence requires
 * wherever a definition is shown: the lookup panel displays it with every answer.
 */
export type DictionaryInfo = {
  id: string;
  provider: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  modelCardUrl: string;
  provenanceUrl: string;
  attribution: string;
};

/** One meaning of a headword: its definition, the dataset's examples, the other words that share it and the words opposite to it. */
export type DictionarySense = { definition: string; examples: string[]; synonyms: string[]; antonyms: string[] };

/** One headword in one part of speech (`noun`, `verb`, `adjective` or `adverb`), its senses most common first. */
export type DictionaryEntry = { headword: string; partOfSpeech: string; senses: DictionarySense[] };

/**
 * What a lookup answers: `ok` with the word it looked up (lower case, surrounding punctuation removed; an inflected word finds its base
 * word) and its entries (none when the dictionary does not have the word), or `asset_required` when the dictionary is not installed yet,
 * the same first-use gate as the other downloads: the UI offers `assetsInstall('dictionary', dictionary.id)`, and nothing downloads until
 * the narrator confirms.
 */
export type DictionaryLookupResult =
  | { status: 'ok'; query: string; entries: DictionaryEntry[]; dictionary: DictionaryInfo }
  | { status: 'asset_required'; dictionary: DictionaryInfo; installState: AssetInstallState; downloadSize: number; diskSize: number; installPath: string };

export interface DictionaryApi {
  /**
   * Looks one word from the manuscript up in the offline dictionary, in the desktop host (no cloud API, no server). A selection that is not
   * one word (empty, several words, too long) is rejected with a message to show as it is.
   */
  systemLookup(word: string): Promise<DictionaryLookupResult>;
}
