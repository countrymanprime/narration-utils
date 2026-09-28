import { z } from 'zod';
import type { ApprovedCharacterReference, CharacterReference, CharacterReferenceSnapshot, CharacterRegion } from '../contracts/character';
import { listFromNull } from './base';

const characterRegionSchema = z.object({
  index: z.number(),
  name: z.string(),
  start: z.number(),
  end: z.number(),
  guid: z.string(),
}) satisfies z.ZodType<CharacterRegion>;

/** The region list: the host sends an empty list for a project with none. */
export const characterRegionsSchema = listFromNull(characterRegionSchema);

const characterReferenceSnapshotSchema = z.object({
  name: z.string(),
  start: z.number(),
  end: z.number(),
}) satisfies z.ZodType<CharacterReferenceSnapshot>;

export const characterReferenceSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  regionGuid: z.string(),
  snapshot: characterReferenceSnapshotSchema,
  // Go marshals `Note string `json:"note,omitempty"`` as an absent key when empty, never null.
  approvedAt: z.string(),
  note: z.string().optional(),
}) satisfies z.ZodType<CharacterReference>;

const approvedCharacterReferenceSchema = characterReferenceSchema.extend({
  changedSinceApproval: z.boolean(),
}) satisfies z.ZodType<ApprovedCharacterReference>;

/** The reference list: the host sends an empty list for a project with none. */
export const approvedCharacterReferencesSchema = listFromNull(approvedCharacterReferenceSchema);
