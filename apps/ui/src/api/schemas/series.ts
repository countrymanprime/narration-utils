import { z } from 'zod';
import type { Series, SeriesVoiceBible, SeriesVoiceBibleCharacter, SeriesVoiceBibleClip } from '../contracts/series';
import { listFromNull } from './base';

export const seriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberProjectPaths: listFromNull(z.string()),
}) satisfies z.ZodType<Series>;

/** The series list: the host sends an empty list for a fresh install with no series.json yet. */
export const seriesListSchema = listFromNull(seriesSchema);

const seriesVoiceBibleClipSchema = z.object({
  id: z.string(),
  projectPath: z.string(),
  book: z.string(),
  isCurrentProject: z.boolean(),
  regionGuid: z.string(),
  name: z.string(),
  start: z.number(),
  end: z.number(),
  approvedAt: z.string(),
  note: z.string().optional(),
  changedSinceApproval: z.boolean().optional(),
}) satisfies z.ZodType<SeriesVoiceBibleClip>;

const seriesVoiceBibleCharacterSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  clips: listFromNull(seriesVoiceBibleClipSchema),
}) satisfies z.ZodType<SeriesVoiceBibleCharacter>;

export const seriesVoiceBibleSchema = z.object({
  inSeries: z.boolean(),
  seriesId: z.string().optional(),
  seriesName: z.string().optional(),
  bookCount: z.number(),
  characters: z.array(seriesVoiceBibleCharacterSchema).optional(),
  unreadableBooks: z.array(z.string()).optional(),
}) satisfies z.ZodType<SeriesVoiceBible>;
