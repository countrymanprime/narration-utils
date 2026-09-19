import type { TtsInstallState, TtsVoice } from './tts';
import type { WorkJob } from './manuscript';

export type GuideEvidence = { chapter: string; chapterId?: string; paragraph: number; paragraphId?: string; excerpt: string; sourceLine?: number };
export type GuideRelationship = { id: string; name: string; label: string };
export type GuidePronunciation = { ipa: string; source: string; confidence: string };
export type GuideNote = { text: string; evidence: { chapter?: string; excerpt?: string } };
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
  locked: boolean;
  review_state: string;
  context?: string;
};

// Native sidecars may contain older records where optional collection fields
// were serialized as null. Keep every UI consumer on the stable array shape.
export function normalizeGuideEntity(entity: GuideEntity): GuideEntity {
  return {
    ...entity,
    aliases: (entity.aliases ?? []).map((alias) => ({ ...alias, occurrences: alias.occurrences ?? [] })),
    occurrences: entity.occurrences ?? [],
    personality_notes: entity.personality_notes ?? [],
    relationships: entity.relationships ?? [],
  };
}
export type GuidePreview =
  | { status: 'ready'; audioBase64: string; mimeType: string }
  | { status: 'asset_required'; voice: Omit<TtsVoice, 'downloadSize' | 'installState'>; installState: TtsInstallState; downloadSize: number };

export interface StoryBibleApi {
  guideBuild(): Promise<WorkJob>;
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
