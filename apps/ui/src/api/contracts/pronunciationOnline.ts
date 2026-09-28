/**
 * The online pronunciation lookup (Go: `apps/desktop/internal/pronunciationonline`, `docs/prds/prep-depth.prd.md`
 * Phase 9, ADR 0405 point 2 and ADR 0356): Merriam-Webster's dictionary, on the narrator's own free key, one word at a
 * time, cached on this computer. The key goes to the host once (`pronunciationOnlineKeySet`) and never comes back: the
 * status only says whether one is saved.
 */
export interface PronunciationOnlineKeyStatus {
  source: string;
  label: string;
  present: boolean;
  /** Whether the saved key is sealed by Windows' own credential protection (DPAPI); false only off Windows. */
  protectedAtRest: boolean;
}

/** One pronunciation the dictionary gives, in its own notation (Merriam-Webster's respelling, not IPA). */
export interface PronunciationOnlineSpelling {
  headword: string;
  spelling: string;
}

export interface PronunciationOnlineResult {
  word: string;
  source: string;
  label: string;
  /** The notation `spelling` is in, for the narrator. */
  notation: string;
  found: boolean;
  pronunciations: PronunciationOnlineSpelling[];
  /** The dictionary's suggested spellings when it does not have the word. */
  suggestions: string[];
  /** True when the answer came from the local cache: no request was sent. */
  cached: boolean;
  fetchedAt: string;
}

export interface PronunciationOnlineBatchResult {
  words: number;
  fetched: number;
  fromCache: number;
  notFound: number;
  failed: number;
  stopped: boolean;
  stopReason: string;
}

/** The most words one batch lookup sends; the host refuses more. */
export const PRONUNCIATION_ONLINE_MAX_BATCH = 200;

export interface PronunciationOnlineApi {
  pronunciationOnlineKeyStatus(): Promise<PronunciationOnlineKeyStatus>;
  /** Saves the narrator's pasted key. An error never quotes what was pasted. */
  pronunciationOnlineKeySet(key: string): Promise<PronunciationOnlineKeyStatus>;
  pronunciationOnlineKeyClear(): Promise<PronunciationOnlineKeyStatus>;
  /** Opens the dictionary's free-key sign-up page (a fixed address of the host's own) in the narrator's browser. */
  pronunciationOnlineSignUpOpen(): Promise<void>;
  /** Looks up one word or short name the narrator pressed Look up for; the host refuses a passage, a path or a file name. */
  pronunciationOnlineLookup(word: string): Promise<PronunciationOnlineResult>;
  /**
   * Looks every word up once, after the narrator confirmed a notice naming how many words it sends. `confirmedCount`
   * must be exactly the number of distinct words (case-insensitive), or the host sends nothing.
   */
  pronunciationOnlineLookupBatch(words: string[], confirmedCount: number): Promise<PronunciationOnlineBatchResult>;
}
