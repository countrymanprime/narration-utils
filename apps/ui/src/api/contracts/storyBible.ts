import type { AssetInstallState } from './assets';
import type { TtsInstallState, TtsVoice } from './tts';
import type { WorkJob } from './manuscript';

export type GuideEvidence = { chapter: string; chapterId?: string; paragraph: number; paragraphId?: string; excerpt: string; sourceLine?: number };
export type GuideRelationship = { id: string; name: string; label: string };
/** Where the narrator is with a pronunciation (prep-depth P1, ADR 0342): looked up, asked of the author, or confirmed by the author. */
export type GuidePronunciationStatus = 'researched' | 'query_sent' | 'author_confirmed';
/** The pronunciation itself, without the narrator's bookkeeping about it. */
export type GuidePronunciationValue = { ipa: string; source: string; confidence: string };
/**
 * A name's pronunciation. `source` is `user` for one the narrator typed. `alternate` is the one of the other kind (the narrator's own
 * or a dictionary's) kept beside it, so switching back is lossless. The schema fills `status` (`researched` on an entry written before it).
 */
export type GuidePronunciation = GuidePronunciationValue & {
  chosen?: boolean;
  status?: GuidePronunciationStatus;
  note?: string;
  alternate?: GuidePronunciationValue;
};
export type GuideNote = { text: string; evidence: { chapter?: string; excerpt?: string } };
/** One labelled fact of an entry ("Codename": "Wren"). The list is ordered and a key is unique whatever its case; a value may be empty. */
export type GuideProperty = { key: string; value: string };
export type GuideAlias = { text: string; pronunciation: GuidePronunciation; occurrences: GuideEvidence[] };
export type GuideEntity = {
  id: string;
  canonical_name: string;
  aliases: GuideAlias[];
  category: string;
  occurrences: GuideEvidence[];
  occurrence_count: number;
  pronunciation: GuidePronunciation;
  description: GuideNote;
  personality_notes: GuideNote[];
  relationships: GuideRelationship[];
  /** The narrator's ordered facts about the entry, filled by hand or from the labelled lines of an imported cast block; empty when there are none. */
  properties: GuideProperty[];
  locked: boolean;
  review_state: string;
  context?: string;
};

/**
 * One name whose pronunciation the author has not confirmed (prep-depth P3): the entity's own (`aliasIndex` null) or one alias, with
 * the chapter and excerpt of its first occurrence (empty when it never occurs). Derived from the Story Bible on every read.
 */
export type PronunciationQuery = {
  entityId: string;
  aliasIndex: number | null;
  name: string;
  entry: string;
  category: string;
  ipa: string;
  source: string;
  status: GuidePronunciationStatus;
  note: string;
  chapter: string;
  excerpt: string;
};
/** The query list as CSV text (header plus one row per query) and how many rows it has. */
export type PronunciationQueriesCsv = { csv: string; count: number };

export type GuidePreview =
  | { status: 'ready'; audioBase64: string; mimeType: string }
  | {
      status: 'asset_required';
      voice: Omit<TtsVoice, 'downloadSize' | 'installState'>;
      installState: TtsInstallState;
      downloadSize: number;
      diskSize: number;
      installPath: string;
    };

/** A spaCy language model as the host describes it before it is installed. */
export type LanguageModel = {
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

/** The answer to starting a build: it started, or the language model it needs is not installed and the narrator is asked (download, rules-only this once, cancel). */
export type GuideBuildResult =
  | { status: 'started'; job: WorkJob }
  | { status: 'asset_required'; model: LanguageModel; installState: AssetInstallState; downloadSize: number; diskSize: number; installPath: string };

export interface StoryBibleApi {
  /**
   * Starts the Story Bible build with the language model the narrator selected, or answers `asset_required` when that model is not
   * installed (the first-use gate). `rulesOnly` builds without a model for this run: lower quality, chosen by the narrator.
   */
  guideBuild(options?: { rulesOnly?: boolean }): Promise<GuideBuildResult>;
  guideBuildState(): Promise<WorkJob>;
  guideEntities(): Promise<GuideEntity[]>;
  guideEdit(id: string, values: Record<string, string>): Promise<void>;
  guideSetLocked(id: string, locked: boolean): Promise<void>;
  guideRescan(id: string): Promise<void>;
  guideCreate(name: string, category: string, aliases: string[]): Promise<string>;
  guideMerge(sourceId: string, targetId: string): Promise<void>;
  guideDelete(id: string): Promise<void>;
  guideRelate(id: string, otherId: string, label: string): Promise<void>;
  guideUnrelate(id: string, otherId: string, label: string): Promise<void>;
  guidePreview(id: string, aliasIndex?: number): Promise<GuidePreview>;
  /**
   * Sets the pronunciation of the entry's own name (`aliasIndex` omitted) or one of its aliases from exactly `source`
   * ("cmu" or "espeak"), and marks it as the narrator's explicit choice so a rebuild keeps it (D13, B9-B11). Refused
   * on a locked entity, and when the chosen engine has nothing for the name.
   */
  guidePronounce(id: string, source: 'cmu' | 'espeak', aliasIndex?: number): Promise<void>;
  /** Sets the narrator's own pronunciation (source `user`); the one it replaces is kept as the alternate. Never asks a dictionary. */
  guidePronounceUser(id: string, ipa: string, aliasIndex?: number): Promise<void>;
  /** Puts the kept alternate back in use, keeping the one it replaces: lossless both ways. */
  guidePronunciationUseAlternate(id: string, aliasIndex?: number): Promise<void>;
  /** Sets a pronunciation's status and, when `note` is given, its note (an empty one clears it). */
  guidePronunciationSetStatus(id: string, status: GuidePronunciationStatus, note?: string, aliasIndex?: number): Promise<void>;
  /** Every name not yet author confirmed, once each, in reading order (prep-depth P3). */
  guidePronunciationQueries(): Promise<PronunciationQuery[]>;
  /** The same list as CSV text, for the narrator to save and send to the author. */
  guidePronunciationQueriesCsv(): Promise<PronunciationQueriesCsv>;
}
