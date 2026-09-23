import { z } from 'zod';
import type { ChapterTrackMapping, TrackMapping } from '../contracts/chapterTrackMap';
import { listFromNull } from './base';

export const trackMappingSchema = z.object({
  trackGuid: z.string(),
  chapterId: z.string(),
  chapterTitle: z.string(),
  confirmedAt: z.string(),
}) satisfies z.ZodType<TrackMapping>;

/** `mappings` is a null slice on the wire when nothing has been confirmed yet. */
export const chapterTrackMappingSchema = z.object({
  documentId: z.string(),
  mappings: listFromNull(trackMappingSchema),
}) satisfies z.ZodType<ChapterTrackMapping>;
