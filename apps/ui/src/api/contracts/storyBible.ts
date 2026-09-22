import type { AssetInstallState } from './assets';
import type { TtsInstallState, TtsVoice } from './tts';
import type { WorkJob } from './manuscript';

export type GuideEvidence = { chapter: string; chapterId?: string; paragraph: number; paragraphId?: string; excerpt: string; sourceLine?: number };
export type GuideRelationship = { id: string; name: string; label: string };
export type GuidePronunciation = { ipa: string; source: string; confidence: string };
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
}
