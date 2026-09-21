import { z } from 'zod';
import type { GuideAlias, GuideEntity, GuideEvidence, GuideNote, GuidePreview, GuidePronunciation, GuideRelationship } from '../contracts/storyBible';
import { listFromNull, optionalFromNull } from './base';
import { ttsInstallStateSchema, ttsVoiceIdentitySchema } from './tts';

const evidenceSchema = z.object({
  chapter: z.string(),
  chapterId: z.string().optional(),
  paragraph: z.number(),
  paragraphId: z.string().optional(),
  excerpt: z.string(),
  sourceLine: z.number().optional(),
}) satisfies z.ZodType<GuideEvidence>;

// The guide file is written by a Python sidecar across several schema generations, and the host fills a missing pronunciation with
// an empty object and a missing description with an empty one (guide/service.go). The schema reads all of those as the complete
// shape, which replaces the hand-written normalizeGuideEntity and fixes the empty-object case it never handled.
const pronunciationSchema = z
  .object({ ipa: z.string().default(''), source: z.string().default(''), confidence: z.string().default('') })
  .nullish()
  .transform((value): GuidePronunciation => value ?? { ipa: '', source: '', confidence: '' });

const noteEvidenceSchema = z
  .object({ chapter: z.string().optional(), excerpt: z.string().optional() })
  .nullish()
  .transform((value): GuideNote['evidence'] => value ?? {});

const noteSchema = z.object({ text: z.string().default(''), evidence: noteEvidenceSchema }) satisfies z.ZodType<GuideNote>;

const aliasSchema = z.object({
  text: z.string(),
  pronunciation: pronunciationSchema,
  occurrences: listFromNull(evidenceSchema),
}) satisfies z.ZodType<GuideAlias>;

const relationshipSchema = z.object({ id: z.string(), name: z.string(), label: z.string() }) satisfies z.ZodType<GuideRelationship>;

const guideEntitySchema = z.object({
  id: z.string(),
  canonical_name: z.string(),
  aliases: listFromNull(aliasSchema),
  category: z.string(),
  occurrences: listFromNull(evidenceSchema),
  occurrence_count: z.number(),
  pronunciation: pronunciationSchema,
  description: noteSchema.nullish().transform((value): GuideNote => value ?? { text: '', evidence: {} }),
  personality_notes: listFromNull(noteSchema),
  relationships: listFromNull(relationshipSchema),
  locked: z.boolean(),
  review_state: z.string(),
  context: optionalFromNull(z.string()),
  /** Set by the sidecar on an entry the narrator wrote by hand; the page does not read it. */
  manual: z.boolean().optional(),
}) satisfies z.ZodType<GuideEntity>;

/** The entity list: the host sends an empty list for no Story Bible yet, and an older host null. */
export const guideEntitiesSchema = listFromNull(guideEntitySchema);

export const guideCreatedSchema = z.object({ id: z.string() });

export const guidePreviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), audioBase64: z.string(), mimeType: z.string() }),
  z.object({ status: z.literal('asset_required'), voice: ttsVoiceIdentitySchema, installState: ttsInstallStateSchema, downloadSize: z.number() }),
]) satisfies z.ZodType<GuidePreview>;
